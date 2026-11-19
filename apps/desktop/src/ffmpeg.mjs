import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentEnv } from './agents.mjs';
import { buildStitchArgs, ffmpegBuilds, ffmpegRelease, ffmpegUrl, maxClipBytes, maxClips, maxTotalBytes, parseProbe, videoSize } from './ffmpeg-models.mjs';
import { downloadFile, extractZip } from './sd.mjs';

const binaryName = (platform) => platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There )/.test(cause.message) ? cause.message
  : 'The download failed. Check your connection and try again.';

/**
 * Joins the clips of a storyboard into one MP4 with ffmpeg. The build is downloaded into `dir` after the user agrees
 * (the caller asks) and verified against a pinned hash. The renderer can only send clip bytes, their lengths and an
 * aspect ratio; it never supplies a path or a command line.
 */
export function createFfmpeg({ dir, platform = process.platform, arch = process.arch, env = process.env, fetchImpl = fetch, spawnProcess = spawn, extract = extractZip, builds = ffmpegBuilds } = {}) {
  const build = builds[`${platform}-${arch}`];
  const engineRoot = join(dir, 'engine');
  const engineDir = join(engineRoot, ffmpegRelease);
  const exe = join(engineDir, binaryName(platform));
  const work = join(dir, 'work');
  let job;
  let lastError = null;
  const runs = new Map();
  let queue = Promise.resolve();

  async function install(state) {
    const { signal } = state.controller;
    mkdirSync(engineRoot, { recursive: true });
    const zip = join(engineRoot, build.asset);
    const unpack = join(engineRoot, 'unpack');
    state.received = 0;
    state.total = build.bytes;
    await downloadFile(fetchImpl, ffmpegUrl(build), zip, { sha256: build.sha256, signal, onBytes: (n) => { state.received += n; } });
    rmSync(unpack, { recursive: true, force: true });
    mkdirSync(unpack, { recursive: true });
    try {
      await extract(zip, unpack, { platform, env, spawnProcess }, 'the video tool');
      // The archive holds one folder with bin/ffmpeg; only the program itself (and its license) is kept.
      const top = readdirSync(unpack, { withFileTypes: true }).find((item) => item.isDirectory());
      const found = [join(unpack, binaryName(platform)), ...(top ? [join(unpack, top.name, 'bin', binaryName(platform))] : [])].find((file) => existsSync(file));
      if (!found) throw new Error('Could not unpack the video tool.');
      rmSync(engineDir, { recursive: true, force: true });
      mkdirSync(engineDir, { recursive: true });
      copyFileSync(found, exe);
      if (top && existsSync(join(unpack, top.name, 'LICENSE.txt'))) copyFileSync(join(unpack, top.name, 'LICENSE.txt'), join(engineDir, 'LICENSE.txt'));
      if (platform !== 'win32') chmodSync(exe, 0o755);
    } finally {
      rmSync(unpack, { recursive: true, force: true });
      rmSync(zip, { force: true });
    }
  }

  /** Runs ffmpeg and returns what it printed; `onText` sees it as it arrives. */
  function run(args, controller, onText) {
    return new Promise((resolve, reject) => {
      const proc = spawnProcess(exe, args, { env: agentEnv(env), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const stop = () => proc.kill();
      controller.signal.addEventListener('abort', stop, { once: true });
      let output = '';
      proc.stderr?.on('data', (chunk) => { output = (output + chunk).slice(-16000); onText?.(String(chunk)); });
      proc.on('error', () => { controller.signal.removeEventListener('abort', stop); reject(new Error('The video tool could not start.')); });
      proc.on('exit', (code) => { controller.signal.removeEventListener('abort', stop); resolve({ code, output }); });
    });
  }

  async function execute(runId, { clips, aspectRatio }, controller, onProgress) {
    controller.signal.throwIfAborted();
    const folder = join(work, runId);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const out = join(folder, 'out.mp4');
    try {
      const files = [];
      for (const [index, clip] of clips.entries()) {
        const file = join(folder, `clip-${index}.bin`);
        writeFileSync(file, clip.data);
        const probe = parseProbe((await run(['-hide_banner', '-nostdin', '-i', file], controller)).output);
        controller.signal.throwIfAborted();
        if (!probe.seconds) throw new Error(`Clip ${index + 1} is not a video the video tool can read.`);
        files.push({ file, seconds: clip.seconds, audio: probe.audio });
      }
      const total = files.reduce((sum, { seconds }) => sum + seconds, 0);
      const { code, output } = await run(buildStitchArgs(files, videoSize(aspectRatio), out), controller, (text) => {
        const time = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
        if (time) onProgress?.({ seconds: Math.min(total, Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])), total });
      });
      if (controller.signal.aborted) throw new Error('Stopped.');
      if (code !== 0 || !existsSync(out)) throw new Error(`Joining the clips failed: ${(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? 'unknown error').slice(0, 200)}`);
      return new Uint8Array(readFileSync(out));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  return {
    supported: !!build,
    status() {
      return {
        supported: !!build,
        installed: !!build && existsSync(exe),
        bytes: build?.bytes ?? 0,
        downloading: job ? { received: job.received, total: job.total } : null,
        error: lastError,
      };
    },
    /** Starts downloading ffmpeg in the background; progress is in `status()`. */
    download() {
      if (!build || job || existsSync(exe)) return false;
      const state = job = { received: 0, total: build.bytes, controller: new AbortController() };
      lastError = null;
      install(state).catch((cause) => { lastError = state.controller.signal.aborted ? null : failure(cause); }).finally(() => { if (job === state) job = undefined; });
      return true;
    },
    cancelDownload() { job?.controller.abort(); },
    remove() {
      if (job || runs.size) return false;
      rmSync(engineRoot, { recursive: true, force: true });
      return true;
    },
    /**
     * Joins `{ clips: [{ data, seconds }], aspectRatio? }` into one MP4 and returns its bytes. Rejects with a message
     * the user can read; only one runs at a time.
     */
    stitch(runId, input, onProgress) {
      const { clips, aspectRatio } = input && typeof input === 'object' ? input : {};
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) return Promise.reject(new Error('Invalid video run.'));
      if (!build || !existsSync(exe)) return Promise.reject(new Error('Download the video tool first.'));
      if (!Array.isArray(clips) || !clips.length || clips.length > maxClips) return Promise.reject(new Error(`Join between 1 and ${maxClips} clips.`));
      if (aspectRatio !== undefined && typeof aspectRatio !== 'string') return Promise.reject(new Error('Invalid aspect ratio.'));
      let total = 0;
      for (const clip of clips) {
        const size = clip?.data?.byteLength;
        if (!(clip?.data instanceof Uint8Array || clip?.data instanceof ArrayBuffer) || !size || size > maxClipBytes) return Promise.reject(new Error('A clip is missing or larger than 100 MB.'));
        if (typeof clip.seconds !== 'number' || !Number.isFinite(clip.seconds) || clip.seconds < 1 || clip.seconds > 60) return Promise.reject(new Error('Each clip needs a length of 1 to 60 seconds.'));
        total += size;
      }
      if (total > maxTotalBytes) return Promise.reject(new Error('The clips are too large to join together.'));
      const prepared = clips.map(({ data, seconds }) => ({ data: data instanceof ArrayBuffer ? new Uint8Array(data) : data, seconds }));
      const controller = new AbortController();
      runs.set(runId, controller);
      const task = queue.then(() => execute(runId, { clips: prepared, aspectRatio }, controller, onProgress));
      queue = task.catch(() => {});
      return task.finally(() => { runs.delete(runId); });
    },
    cancel(runId) { runs.get(runId)?.abort(); },
    stop() {
      job?.controller.abort();
      for (const controller of runs.values()) controller.abort();
    },
  };
}
