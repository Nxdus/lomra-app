import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { agentEnv } from './agents.mjs';
import { defaultLocal3dModel, local3dDownloads, local3dModels, local3dPackages, local3dPackagesBytes, local3dSource, local3dTorch, local3dUv, local3dVersion } from './local3d-models.mjs';

const exeName = (platform) => platform === 'win32' ? '.exe' : '';
const pythonPath = (venv, platform) => platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
const maxImageBytes = 20 * 1024 * 1024;
const workerFiles = ['worker.py', 'torchmcubes.py'];

/** Streams `url` to `file`, checking its SHA-256. Nothing is left at `file` unless the hash matches. */
async function downloadFile(fetchImpl, url, file, { sha256, signal, onBytes }) {
  const response = await fetchImpl(url, { signal });
  if (response.status === 401 || response.status === 403) throw new Error('This download needs a login, which Lomra does not support.');
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
function extractZip(zip, dest, { platform, env, spawnProcess }) {
  const [command, args] = platform === 'linux' ? ['unzip', ['-q', '-o', zip, '-d', dest]]
    : [platform === 'win32' ? join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', dest]];
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(command, args, { windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => reject(new Error('Could not unpack a download.')));
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Could not unpack a download.')));
  });
}

/** The video memory (MiB) of the first NVIDIA graphics card, or 0 when there is none. */
function nvidiaMemory({ env, spawnProcess }) {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try { proc = spawnProcess('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { env: agentEnv(env), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { resolve(0); return; }
    proc.stdout?.on('data', (chunk) => { out += chunk; });
    proc.on('error', () => resolve(0));
    proc.on('exit', (code) => resolve(code === 0 ? Number.parseInt(out.trim().split(/\r?\n/)[0], 10) || 0 : 0));
  });
}

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There |Installing |This )/.test(cause.message) ? cause.message
  : 'The installation failed. Check your connection and try again.';

/** A short reason for a failed run, from the worker's last JSON line. */
export function workerError(output) {
  const last = output.split(/\r?\n/).reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item?.stage === 'error');
  if (last?.reason === 'memory') return 'Not enough graphics memory for this picture. Close other apps that use the graphics card, or try a smaller model.';
  if (last?.reason === 'no-cuda') return 'The 3D engine could not use the NVIDIA graphics card. Update its driver and try again.';
  const detail = typeof last?.detail === 'string' ? last.detail.split('\n').filter(Boolean).pop()?.slice(0, 160) : '';
  return detail ? `The 3D model could not be made: ${detail}` : 'The 3D model could not be made.';
}

/**
 * Local image-to-3D. One Python environment (uv, a private Python, CUDA PyTorch and the shared libraries) is installed into
 * `dir` after the user agrees (the caller asks), then each model's weights on request. Every download is checked against a
 * SHA-256 and packages are exact versions. A run starts a fresh worker process, one at a time. The renderer can only name
 * a model id and pass a picture; it never supplies a path or a command line.
 */
export function createLocal3d({ dir, platform = process.platform, arch = process.arch, env = process.env, fetchImpl = fetch, spawnProcess = spawn, extract = extractZip, gpuMemory = () => nvidiaMemory({ env, spawnProcess }), uv = local3dUv, downloads = local3dDownloads, source = local3dSource, models = local3dModels, workerDir: workerSource = join(dirname(fileURLToPath(import.meta.url)), 'local3d-worker') } = {}) {
  const tool = uv[`${platform}-${arch}`];
  const venv = join(dir, 'venv');
  const python = pythonPath(venv, platform);
  const uvDir = join(dir, 'uv');
  const uvExe = join(uvDir, `uv${exeName(platform)}`);
  const modelsDir = join(dir, 'models');
  const workerDir = join(dir, 'worker');
  const packagesMarker = join(dir, 'packages.json');
  const engineBytes = () => (tool?.bytes ?? 0) + source.bytes + local3dPackagesBytes + downloads.reduce((sum, item) => sum + item.bytes, 0);
  const modelBytes = (model) => model.weights.reduce((sum, item) => sum + item.bytes, 0) + (model.source?.bytes ?? 0);
  const find = (id) => models.find((model) => model.id === (id ?? defaultLocal3dModel));
  const marker = (model) => join(dir, model.source.path, '.ok');
  const engineReady = () => {
    try { if (JSON.parse(readFileSync(packagesMarker, 'utf8')).version !== local3dVersion) return false; } catch { return false; }
    return existsSync(python) && downloads.every((item) => existsSync(join(dir, item.path)));
  };
  const hasFiles = (model) => model.weights.every((item) => existsSync(join(modelsDir, item.path))) && (!model.source || existsSync(marker(model)));
  const installed = (model) => engineReady() && hasFiles(model);
  let job;
  let lastError = null;
  let gpu;
  const runs = new Map();
  let queue = Promise.resolve();

  const uvEnv = () => ({ ...agentEnv(env), UV_PYTHON_INSTALL_DIR: join(dir, 'python'), UV_CACHE_DIR: join(dir, 'cache'), UV_NO_CONFIG: '1', UV_PYTHON_PREFERENCE: 'only-managed', UV_NO_PROGRESS: '1', VIRTUAL_ENV: '' });

  function runUv(args, signal) {
    return new Promise((resolve, reject) => {
      let output = '';
      const proc = spawnProcess(uvExe, args, { cwd: dir, env: uvEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const stop = () => proc.kill();
      signal.addEventListener('abort', stop, { once: true });
      const read = (chunk) => { output = (output + chunk).slice(-4000); };
      proc.stdout?.on('data', read);
      proc.stderr?.on('data', read);
      proc.on('error', () => reject(new Error('Installing the 3D engine failed: the installer could not start.')));
      proc.on('exit', (code) => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) return reject(new Error('Stopped.'));
        if (code === 0) return resolve();
        if (/No space left|os error 112/i.test(output)) return reject(new Error('There is not enough disk space.'));
        reject(new Error('Installing the 3D engine failed. Check your connection and try again.'));
      });
    });
  }

  /** Unpacks a source archive that wraps everything in one folder into `target`, replacing what is there. */
  async function unpackSource(item, state, signal) {
    const zip = join(dir, `${item.path.replace(/\W+/g, '-')}.zip`);
    await downloadFile(fetchImpl, item.url, zip, { sha256: item.sha256, signal, onBytes: (n) => { state.received += n; } });
    const unpack = join(dir, 'unpack');
    rmSync(unpack, { recursive: true, force: true });
    mkdirSync(unpack, { recursive: true });
    try {
      await extract(zip, unpack, { platform, env, spawnProcess });
      const [top] = readdirSync(unpack);
      if (!top) throw new Error('Could not unpack a download.');
      const target = join(dir, item.path);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(unpack, top), target);
      return target;
    } finally {
      rmSync(unpack, { recursive: true, force: true });
      rmSync(zip, { force: true });
    }
  }

  async function fetchFile(item, target, state, signal) {
    if (existsSync(target)) return;
    mkdirSync(dirname(target), { recursive: true });
    await downloadFile(fetchImpl, item.url, target, { sha256: item.sha256, signal, onBytes: (n) => { state.received += n; } });
  }

  async function install(model, state) {
    const { signal } = state.controller;
    mkdirSync(dir, { recursive: true });
    const stage = (name, label, total = 0) => { state.stage = name; state.label = label; state.received = 0; state.total = total; };

    if (!engineReady()) {
      if (!existsSync(uvExe)) {
        stage('download', 'Installer', tool.bytes);
        const zip = join(dir, tool.asset);
        await downloadFile(fetchImpl, tool.url, zip, { sha256: tool.sha256, signal, onBytes: (n) => { state.received += n; } });
        const unpack = join(dir, 'uv-unpack');
        rmSync(unpack, { recursive: true, force: true });
        mkdirSync(unpack, { recursive: true });
        try {
          await extract(zip, unpack, { platform, env, spawnProcess });
          const found = existsSync(join(unpack, `uv${exeName(platform)}`)) ? unpack : join(unpack, readdirSync(unpack)[0] ?? '');
          if (!existsSync(join(found, `uv${exeName(platform)}`))) throw new Error('Could not unpack a download.');
          rmSync(uvDir, { recursive: true, force: true });
          renameSync(found, uvDir);
        } finally {
          rmSync(unpack, { recursive: true, force: true });
          rmSync(zip, { force: true });
        }
      }
      if (!existsSync(python)) {
        stage('python', 'Python');
        await runUv(['venv', '--python', '3.10', venv], signal);
      }
      stage('packages', 'Graphics libraries (PyTorch)');
      await runUv(['pip', 'install', '--python', python, ...local3dTorch.requirements, '--index-url', local3dTorch.index], signal);
      const sourceZip = join(dir, 'hunyuan3d-source.zip');
      stage('download', 'Hunyuan3D code', source.bytes);
      await downloadFile(fetchImpl, source.url, sourceZip, { sha256: source.sha256, signal, onBytes: (n) => { state.received += n; } });
      stage('packages', 'Other libraries');
      const requirements = join(dir, 'requirements.txt');
      writeFileSync(requirements, `${local3dPackages.join('\n')}\n`);
      await runUv(['pip', 'install', '--python', python, '-r', requirements], signal);
      await runUv(['pip', 'install', '--python', python, '--no-deps', sourceZip], signal);
      rmSync(sourceZip, { force: true });
      rmSync(join(dir, 'cache'), { recursive: true, force: true });
      stage('download', 'Background remover', downloads.reduce((sum, item) => sum + item.bytes, 0));
      for (const item of downloads) await fetchFile(item, join(dir, item.path), state, signal);
      writeFileSync(packagesMarker, JSON.stringify({ version: local3dVersion }));
    }

    if (model.source && !existsSync(marker(model))) {
      stage('download', `${model.name} code`, model.source.bytes);
      const target = await unpackSource(model.source, state, signal);
      writeFileSync(join(target, '.ok'), '');
    }
    stage('model', model.name, model.weights.reduce((sum, item) => sum + item.bytes, 0));
    for (const item of model.weights) await fetchFile(item, join(modelsDir, item.path), state, signal);
  }

  async function execute(runId, model, image, controller, onProgress) {
    controller.signal.throwIfAborted();
    mkdirSync(join(dir, 'out'), { recursive: true });
    mkdirSync(workerDir, { recursive: true });
    const input = join(dir, 'out', `${runId}.png`);
    const out = join(dir, 'out', `${runId}.glb`);
    // The scripts ship inside the app archive, where Python cannot read them; keep copies next to the environment.
    for (const name of workerFiles) writeFileSync(join(workerDir, name), readFileSync(join(workerSource, name)));
    writeFileSync(input, Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
    const args = model.kind === 'triposr'
      ? ['triposr', input, out, join(modelsDir, model.folder), join(modelsDir, model.folder, 'dino-vitb16-config.json')]
      : ['hunyuan', input, out, model.repo, model.subfolder];
    try {
      let output = '';
      const code = await new Promise((resolve, reject) => {
        const proc = spawnProcess(python, ['-X', 'utf8', join(workerDir, 'worker.py'), ...args], {
          cwd: workerDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...agentEnv(env), HY3DGEN_MODELS: modelsDir, U2NET_HOME: join(dir, 'u2net'), HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1',
            ...(model.source ? { PYTHONPATH: join(dir, model.source.path) } : {}),
          },
        });
        const stop = () => proc.kill();
        controller.signal.addEventListener('abort', stop, { once: true });
        let pending = '';
        proc.stdout?.on('data', (chunk) => {
          output = (output + chunk).slice(-8000);
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) { try { const event = JSON.parse(line); if (typeof event?.stage === 'string' && event.stage !== 'error') onProgress?.({ stage: event.stage }); } catch { /* library noise */ } }
        });
        proc.stderr?.on('data', () => {});
        proc.on('error', () => reject(new Error('The 3D engine could not start.')));
        proc.on('exit', (status) => { controller.signal.removeEventListener('abort', stop); resolve(status); });
      });
      if (controller.signal.aborted) throw new Error('Stopped.');
      if (code !== 0 || !existsSync(out)) throw new Error(workerError(output));
      return `data:model/gltf-binary;base64,${readFileSync(out).toString('base64')}`;
    } finally {
      rmSync(input, { force: true });
      rmSync(out, { force: true });
    }
  }

  return {
    async status() {
      let reason = null;
      if (!tool) reason = 'Local 3D generation is not available for this computer yet.';
      else {
        gpu ??= await gpuMemory();
        if (!gpu) reason = 'Local 3D generation needs an NVIDIA graphics card.';
        else if (gpu < Math.min(...models.map((model) => model.needs))) reason = 'Local 3D generation needs an NVIDIA graphics card with at least 6 GB of memory.';
      }
      return {
        supported: !reason,
        reason,
        engine: engineReady(),
        engineBytes: engineBytes(),
        installing: job ? { id: job.id, name: job.name, stage: job.stage, label: job.label, received: job.received, total: job.total } : null,
        error: lastError,
        models: models.map((model) => ({
          id: model.id, name: model.name, quality: model.quality, note: model.note, license: model.license, bytes: modelBytes(model),
          recommended: !!model.default, installed: installed(model), fits: !!gpu && gpu >= model.needs,
        })),
      };
    },
    /** Starts installing the engine (if missing) and a model in the background; progress is in `status()`. */
    async install(id) {
      const model = find(id);
      if (!tool || !model || job) return false;
      if ((gpu ??= await gpuMemory()) < model.needs) return false;
      const state = job = { id: model.id, name: model.name, stage: 'download', label: 'Installer', received: 0, total: 0, controller: new AbortController() };
      lastError = null;
      install(model, state).catch((cause) => { lastError = state.controller.signal.aborted ? null : failure(cause); }).finally(() => { if (job === state) job = undefined; });
      return true;
    },
    cancelInstall() { job?.controller.abort(); },
    /** Deletes a model's files; the engine goes with the last one. */
    remove(id) {
      const model = models.find((item) => item.id === id);
      if (!model || job || runs.size) return false;
      rmSync(join(modelsDir, model.folder), { recursive: true, force: true });
      if (model.source) rmSync(join(dir, model.source.path), { recursive: true, force: true });
      if (!models.some((item) => item.weights.some((weight) => existsSync(join(modelsDir, weight.path))))) rmSync(dir, { recursive: true, force: true });
      return true;
    },
    /** Makes one 3D model (a GLB data URL) from a picture (an image data URL). Rejects with a message the user can read; one runs at a time. */
    generate(runId, input, onProgress) {
      const image = input && typeof input === 'object' ? input.image : undefined;
      const model = input && typeof input === 'object' ? models.find((item) => item.id === input.model) : undefined;
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) return Promise.reject(new Error('Invalid 3D run.'));
      if (!tool || !model || !installed(model)) return Promise.reject(new Error('Install this 3D model in Settings → Local models first.'));
      if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image) || image.length > maxImageBytes * 1.4) return Promise.reject(new Error('Select one PNG, JPEG or WebP picture of up to 20 MB.'));
      const controller = new AbortController();
      runs.set(runId, controller);
      const run = queue.then(() => execute(runId, model, image, controller, onProgress));
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
