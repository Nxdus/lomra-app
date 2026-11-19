import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { agentEnv } from './agents.mjs';
import { customModelId, defaultSdModel, hfFilePattern, hfRepoPattern, parseHuggingFace, sdDimensions, sdEngineUrl, sdEngines, sdFamilies, sdModelUrl, sdModels, sdRelease } from './sd-models.mjs';

const binaryName = (platform) => platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';

/** Streams `url` to `file`, checking its SHA-256. Nothing is left at `file` unless the hash matches. */
export async function downloadFile(fetchImpl, url, file, { sha256, signal, onBytes }) {
  const response = await fetchImpl(url, { signal });
  if (response.status === 401 || response.status === 403) throw new Error('This model needs a Hugging Face login, which Lomra does not support.');
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
  const part = `${file}.part`;
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); onBytes(chunk.length); done(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part), { signal });
    if (hash.digest('hex') !== sha256) throw new Error('The download was corrupted. Try again.');
    renameSync(part, file);
  } catch (cause) {
    rmSync(part, { force: true });
    throw cause;
  }
}

/** Unpacks a zip with the system's tar (Windows, macOS) or unzip (Linux). */
export function extractZip(zip, dest, { platform, env, spawnProcess }, what = 'the image engine') {
  const [command, args] = platform === 'linux' ? ['unzip', ['-q', '-o', zip, '-d', dest]]
    : [platform === 'win32' ? join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', dest]];
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(command, args, { windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => reject(new Error(`Could not unpack ${what}.`)));
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not unpack ${what}.`)));
  });
}

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There )/.test(cause.message) ? cause.message
  : 'The download failed. Check your connection and try again.';

/** The last meaningful line the engine printed, for an error the user can act on. */
export function engineError(output) {
  const text = output.slice(-4000);
  if (/out of memory|failed to allocate|bad_alloc|ErrorOutOfDeviceMemory/i.test(text)) return 'Not enough memory for this model. Try a smaller model.';
  if (/vulkan|vk[A-Z]\w+ failed|no .*device/i.test(text) && /fail|error|not found|no /i.test(text)) return 'The image engine could not use this computer’s graphics card.';
  const line = text.split(/\r?\n/).map((item) => item.trim()).filter((item) => /error|fail/i.test(item)).pop();
  return line ? `Image generation failed: ${line.slice(0, 200)}` : 'Image generation failed.';
}

/**
 * Local image generation with stable-diffusion.cpp. The engine and checkpoints are downloaded into `dir` after the
 * user agrees (the caller asks), verified against pinned hashes, and run one image at a time. The renderer can only
 * name a model id, a prompt and an aspect ratio; it never supplies a path or a command line.
 */
export function createSd({ dir, platform = process.platform, arch = process.arch, env = process.env, fetchImpl = fetch, spawnProcess = spawn, extract = extractZip, models = sdModels, engines = sdEngines } = {}) {
  const engine = engines[`${platform}-${arch}`];
  const engineRoot = join(dir, 'engine');
  const engineDir = join(engineRoot, sdRelease);
  const exe = join(engineDir, binaryName(platform));
  const customDir = join(dir, 'custom');
  const modelFile = (model) => model.custom ? join(customDir, `${model.id}${model.ext}`) : join(dir, 'models', `${model.id}.safetensors`);
  const metaFile = (id) => join(customDir, `${id}.json`);
  const family = (id) => sdFamilies.find((item) => item.id === id);
  /** A model the user added from Hugging Face, rebuilt from the record saved next to its weights. */
  const fromRecord = (record) => {
    const kind = family(record?.family);
    if (!kind || !/^hf-[a-z0-9-]{1,60}$/.test(record.id) || !hfRepoPattern.test(record.repo) || !hfFilePattern.test(record.file) || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isFinite(record.bytes)) return undefined;
    const ext = extname(record.file).toLowerCase();
    return { id: record.id, name: record.file.slice(0, -ext.length), quality: kind.name, note: record.repo, bytes: record.bytes, custom: true, repo: record.repo, file: record.file, family: kind.id, sha256: record.sha256, ext, size: kind.size, steps: kind.steps, cfg: kind.cfg };
  };
  const customModels = () => {
    try {
      return readdirSync(customDir).filter((name) => name.endsWith('.json')).flatMap((name) => {
        try { return fromRecord(JSON.parse(readFileSync(join(customDir, name), 'utf8'))) ?? []; } catch { return []; }
      });
    } catch { return []; }
  };
  const allModels = () => [...models, ...customModels()];
  const find = (id) => allModels().find((model) => model.id === (id ?? defaultSdModel));

  /** Single-file checkpoints at the top of a Hugging Face repository, with the size and SHA-256 it reports. */
  async function listFiles(repo, signal = AbortSignal.timeout(15_000)) {
    if (typeof repo !== 'string' || !hfRepoPattern.test(repo)) throw new Error('Enter a Hugging Face model as owner/name.');
    let response;
    try { response = await fetchImpl(`https://huggingface.co/api/models/${repo}/tree/main`, { signal }); } catch { throw new Error('Could not reach Hugging Face.'); }
    if (response.status === 404) throw new Error('That model was not found on Hugging Face.');
    // Hugging Face answers 401 for a repository that does not exist as well as for a private or gated one.
    if (response.status === 401 || response.status === 403) throw new Error('That model was not found, or it needs a Hugging Face login, which Lomra does not support.');
    if (!response.ok) throw new Error('Could not reach Hugging Face.');
    const items = await response.json().catch(() => []);
    return (Array.isArray(items) ? items : []).flatMap((item) => item?.type === 'file' && hfFilePattern.test(item.path ?? '') && /^[a-f0-9]{64}$/.test(item.lfs?.oid ?? '') && Number.isFinite(item.size) && item.size > 0
      ? [{ file: item.path, bytes: item.size, sha256: item.lfs.oid }] : []).slice(0, 50);
  }
  let job;
  let lastError = null;
  const runs = new Map();
  let queue = Promise.resolve();

  async function install(model, state) {
    const { signal } = state.controller;
    mkdirSync(engineRoot, { recursive: true });
    mkdirSync(join(dir, 'models'), { recursive: true });
    mkdirSync(customDir, { recursive: true });
    if (!existsSync(exe)) {
      state.stage = 'engine';
      state.received = 0;
      state.total = engine.bytes;
      const zip = join(engineRoot, engine.asset);
      await downloadFile(fetchImpl, sdEngineUrl(engine), zip, { sha256: engine.sha256, signal, onBytes: (n) => { state.received += n; } });
      const unpack = join(engineRoot, 'unpack');
      rmSync(unpack, { recursive: true, force: true });
      mkdirSync(unpack, { recursive: true });
      try {
        await extract(zip, unpack, { platform, env, spawnProcess });
        if (!existsSync(join(unpack, binaryName(platform)))) throw new Error('Could not unpack the image engine.');
        if (platform !== 'win32') chmodSync(join(unpack, binaryName(platform)), 0o755);
        rmSync(engineDir, { recursive: true, force: true });
        renameSync(unpack, engineDir);
      } finally {
        rmSync(unpack, { recursive: true, force: true });
        rmSync(zip, { force: true });
      }
    }
    if (!existsSync(modelFile(model))) {
      if (model.custom) {
        // The size and hash come from Hugging Face's own listing, so a corrupted download is still caught.
        const info = (await listFiles(model.repo, signal)).find((item) => item.file === model.file);
        if (!info) throw new Error('That file was not found in the model.');
        model = { ...model, bytes: info.bytes, sha256: info.sha256 };
      }
      state.stage = 'model';
      state.received = 0;
      state.total = model.bytes;
      await downloadFile(fetchImpl, sdModelUrl(model), modelFile(model), { sha256: model.sha256, signal, onBytes: (n) => { state.received += n; } });
      if (model.custom) writeFileSync(metaFile(model.id), JSON.stringify({ id: model.id, repo: model.repo, file: model.file, family: model.family, bytes: model.bytes, sha256: model.sha256 }));
    }
  }

  async function execute(runId, model, { prompt, aspectRatio }, controller, onProgress) {
    controller.signal.throwIfAborted();
    const outDir = join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `${runId}.png`);
    const { width, height } = sdDimensions(aspectRatio, model.size);
    const args = ['-m', modelFile(model), '-p', prompt, '-o', out, '-W', String(width), '-H', String(height), '--steps', String(model.steps), '--cfg-scale', String(model.cfg), '--vae-tiling'];
    try {
      let output = '';
      const code = await new Promise((resolve, reject) => {
        const proc = spawnProcess(exe, args, { cwd: engineDir, env: agentEnv(env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const stop = () => proc.kill();
        controller.signal.addEventListener('abort', stop, { once: true });
        const read = (chunk) => {
          output = (output + chunk).slice(-8000);
          const steps = [...String(chunk).matchAll(/(\d+)\/(\d+)\s*-\s*[\d.]+\s*(?:s\/it|it\/s)/g)].pop();
          // Only the sampling steps; the engine prints a second counter for decoding the image.
          if (steps && Number(steps[2]) === model.steps) onProgress?.({ step: Number(steps[1]), total: Number(steps[2]) });
        };
        proc.stdout?.on('data', read);
        proc.stderr?.on('data', read);
        proc.on('error', () => reject(new Error('The image engine could not start.')));
        proc.on('exit', (status) => { controller.signal.removeEventListener('abort', stop); resolve(status); });
      });
      if (controller.signal.aborted) throw new Error('Stopped.');
      if (code !== 0 || !existsSync(out)) throw new Error(engineError(output));
      return `data:image/png;base64,${readFileSync(out).toString('base64')}`;
    } finally {
      rmSync(out, { force: true });
    }
  }

  return {
    supported: !!engine,
    status() {
      return {
        supported: !!engine,
        engine: !!engine && existsSync(exe),
        engineBytes: engine?.bytes ?? 0,
        downloading: job ? { id: job.id, name: job.name, stage: job.stage, received: job.received, total: job.total } : null,
        error: lastError,
        families: sdFamilies.map(({ id, name, note }) => ({ id, name, note })),
        models: allModels().map((model) => ({
          id: model.id, name: model.name, quality: model.quality, note: model.note, bytes: model.bytes,
          recommended: !!model.default, installed: existsSync(modelFile(model)), custom: !!model.custom,
        })),
      };
    },
    /** Starts downloading the engine (if missing) and a model in the background; progress is in `status()`. */
    download(request) {
      let model;
      if (request && typeof request === 'object') {
        const kind = family(request.family);
        if (!kind || typeof request.repo !== 'string' || typeof request.file !== 'string' || !hfRepoPattern.test(request.repo) || !hfFilePattern.test(request.file)) return false;
        const ext = extname(request.file).toLowerCase();
        model = { id: customModelId(request.repo, request.file), name: request.file.slice(0, -ext.length), custom: true, repo: request.repo, file: request.file, family: kind.id, ext, bytes: 0, size: kind.size, steps: kind.steps, cfg: kind.cfg };
      } else model = find(request);
      if (!engine || !model || job) return false;
      const state = job = { id: model.id, name: model.name, stage: 'engine', received: 0, total: 0, controller: new AbortController() };
      lastError = null;
      install(model, state).catch((cause) => { lastError = state.controller.signal.aborted ? null : failure(cause); }).finally(() => { if (job === state) job = undefined; });
      return true;
    },
    /** Single-file checkpoints of a Hugging Face repository (`owner/name`). Rejects with a message the user can read. */
    files(repo) { return listFiles(repo); },
    /**
     * `{ repo, file? }` when `query` is a Hugging Face `owner/name` or link, else the text-to-image models
     * matching it, most downloaded first.
     */
    async search(query) {
      if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Enter something to search for.');
      const direct = query.includes('/') ? parseHuggingFace(query) : null;
      if (direct) return { ...direct, models: [] };
      if (query.length > 100) throw new Error('Enter something to search for.');
      let response;
      try { response = await fetchImpl(`https://huggingface.co/api/models?${new URLSearchParams({ search: query.trim(), filter: 'text-to-image', sort: 'downloads', limit: '15' })}`, { signal: AbortSignal.timeout(15_000) }); } catch { throw new Error('Could not reach Hugging Face.'); }
      if (!response.ok) throw new Error('Could not reach Hugging Face.');
      const items = await response.json().catch(() => []);
      return { models: (Array.isArray(items) ? items : []).flatMap((item) => typeof item?.id === 'string' && hfRepoPattern.test(item.id) ? [{ id: item.id, downloads: Number(item.downloads) || 0 }] : []) };
    },
    cancelDownload() { job?.controller.abort(); },
    /** Deletes a model; the engine goes with the last one. */
    remove(id) {
      const model = allModels().find((item) => item.id === id);
      if (!model || job) return false;
      rmSync(modelFile(model), { force: true });
      if (model.custom) rmSync(metaFile(model.id), { force: true });
      const holds = (folder) => existsSync(folder) && readdirSync(folder).some((file) => /\.(?:safetensors|gguf)$/.test(file));
      const left = holds(join(dir, 'models')) || holds(customDir);
      if (!left) rmSync(engineRoot, { recursive: true, force: true });
      return true;
    },
    /** Makes one image. Rejects with a message the user can read; only one runs at a time. */
    generate(runId, input, onProgress) {
      const model = input && typeof input === 'object' ? allModels().find((item) => item.id === input.model) : undefined;
      const { prompt, aspectRatio } = input ?? {};
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) return Promise.reject(new Error('Invalid image run.'));
      if (!model || !engine || !existsSync(exe) || !existsSync(modelFile(model))) return Promise.reject(new Error('Download this model in Settings → Local models first.'));
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000 || prompt.includes('\0')) return Promise.reject(new Error('Enter a prompt of up to 2000 characters.'));
      if (aspectRatio !== undefined && typeof aspectRatio !== 'string') return Promise.reject(new Error('Invalid aspect ratio.'));
      const controller = new AbortController();
      runs.set(runId, controller);
      const run = queue.then(() => execute(runId, model, { prompt, aspectRatio }, controller, onProgress));
      queue = run.catch(() => {});
      return run.finally(() => { runs.delete(runId); });
    },
    cancel(runId) { runs.get(runId)?.abort(); },
    stop() {
      job?.controller.abort();
      for (const controller of runs.values()) controller.abort();
    },
  };
}
