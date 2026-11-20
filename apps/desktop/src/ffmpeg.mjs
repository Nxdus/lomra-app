import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentEnv } from './agents.mjs';
import { buildStitchArgs, ffmpegBuilds, ffmpegRelease, ffmpegUrl, formatCaptions, maxAudioTracks, maxCaptions, maxClipBytes, maxClips, maxTotalBytes, mediaInputArgs, parseProbe, videoSize } from './ffmpeg-models.mjs';
import { downloadFile, extractZip } from './sd.mjs';

const binaryName = (platform) => platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const isBytes = (data) => (data instanceof Uint8Array || data instanceof ArrayBuffer) && data.byteLength > 0;
const asBytes = (data) => data instanceof ArrayBuffer ? new Uint8Array(data) : data;

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There )/.test(cause.message) ? cause.message
  : 'The download failed. Check your connection and try again.';

/**
 * Joins the clips of a storyboard into one MP4 with ffmpeg. The build is downloaded into `dir` after the user agrees
 * (the caller asks) and verified against a pinned hash. The renderer sends media bytes, edit settings and caption text.
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

  async function execute(runId, { clips, aspectRatio, audio, captions, total }, controller, onProgress) {
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
        const probe = parseProbe((await run(['-hide_banner', '-nostdin', ...mediaInputArgs(file)], controller)).output);
        controller.signal.throwIfAborted();
        if (!probe.video || !Number.isFinite(probe.seconds) || !probe.seconds) throw new Error(`Clip ${index + 1} is not a video the video tool can read.`);
        if (clip.start >= probe.seconds) throw new Error(`Clip ${index + 1} starts outside its source video.`);
        files.push({ file, seconds: clip.seconds, start: clip.start, audio: probe.audio && !clip.mute });
      }
      const tracks = [];
      for (const [index, { data, start, gain }] of audio.entries()) {
        const file = join(folder, `audio-${index}.bin`);
        writeFileSync(file, data);
        const probe = parseProbe((await run(['-hide_banner', '-nostdin', ...mediaInputArgs(file)], controller)).output);
        controller.signal.throwIfAborted();
        if (!probe.audio) throw new Error(`Audio track ${index + 1} is not readable by the video tool.`);
        tracks.push({ file, start, gain });
      }
      const subtitles = captions.length ? join(folder, 'captions.srt') : undefined;
      if (subtitles) writeFileSync(subtitles, formatCaptions(captions), 'utf8');
      const args = buildStitchArgs(files, videoSize(aspectRatio), out, { audio: tracks, captions: subtitles, total });
      const { code, output } = await run(args, controller, (text) => {
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
     * Renders the clips, optional audio and captions into one MP4. Only one job runs at a time.
     */
    async stitch(runId, input, onProgress) {
      const { clips, aspectRatio, audio = [], captions = [] } = input && typeof input === 'object' ? input : {};
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) throw new Error('Invalid video run.');
      if (!build || !existsSync(exe)) throw new Error('Download the video tool first.');
      if (!Array.isArray(clips) || !clips.length || clips.length > maxClips) throw new Error(`Join between 1 and ${maxClips} clips.`);
      if (aspectRatio !== undefined && typeof aspectRatio !== 'string') throw new Error('Invalid aspect ratio.');
      if (!Array.isArray(audio) || audio.length > maxAudioTracks) throw new Error(`Use up to ${maxAudioTracks} audio tracks.`);
      if (!Array.isArray(captions) || captions.length > maxCaptions) throw new Error(`Use up to ${maxCaptions} captions.`);
      let bytes = 0;
      let total = 0;
      const prepared = [];
      for (const clip of clips) {
        if (!isBytes(clip?.data) || clip.data.byteLength > maxClipBytes) throw new Error('A clip is missing or larger than 100 MB.');
        const { data, seconds, start = 0, mute = false } = clip;
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('Each clip needs a length of 1 to 60 seconds.');
        if (!Number.isFinite(start) || start < 0 || typeof mute !== 'boolean') throw new Error('Invalid clip trim or mute setting.');
        const length = Number(seconds.toFixed(3));
        prepared.push({ data: asBytes(data), seconds: length, start, mute });
        total += length;
        bytes += data.byteLength;
      }
      total = Number(total.toFixed(3));
      const tracks = [];
      for (const track of audio) {
        if (!isBytes(track?.data)) throw new Error('An audio track is missing its media.');
        const { data, start, gain = 1 } = track;
        if (!Number.isFinite(start) || start < 0 || start >= total) throw new Error('Each audio track must start within the video.');
        if (!Number.isFinite(gain) || gain < 0 || gain > 2) throw new Error('Audio gain must be between 0 and 2.');
        tracks.push({ data: asBytes(data), start, gain });
        bytes += data.byteLength;
      }
      if (bytes > maxTotalBytes) throw new Error('The media is too large to join together.');
      const subtitles = [];
      for (const caption of captions) {
        const { start, end, text } = caption ?? {};
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > total || start.toFixed(3) === end.toFixed(3) || start >= end) {
          throw new Error('Each caption must have a positive duration within the video, at millisecond precision.');
        }
        if (typeof text !== 'string' || text.length > 2000) throw new Error('Each caption needs up to 2,000 characters of text.');
        // Keep a single SRT text line and neutralize tags interpreted by its decoder.
        const clean = text.replace(/[\p{Cc}\p{Z}\s]+/gu, ' ').replace(/[<>{}]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0)).trim();
        if (!clean) throw new Error('A caption is missing its text.');
        subtitles.push({ start, end, text: clean });
      }
      subtitles.sort((a, b) => a.start - b.start);
      if (subtitles.some(({ start }, index) => index > 0 && start < subtitles[index - 1].end)) throw new Error('Captions cannot overlap.');
      const controller = new AbortController();
      runs.set(runId, controller);
      const task = queue.then(() => execute(runId, { clips: prepared, aspectRatio, audio: tracks, captions: subtitles, total }, controller, onProgress));
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
