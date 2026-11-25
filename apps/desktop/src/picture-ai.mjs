import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentEnv } from './agents.mjs';
import { createDownloadQueue, downloadFile, partBytes, removeParts } from './download.mjs';
import { whenGone } from './gpu-queue.mjs';
import { pictureAiModels } from './picture-ai-models.mjs';
import { picture } from './sd-input.mjs';

const maxOutputSide = 8192;
const maxOutputPixels = 36_000_000;
const defaultWorkerPath = join(dirname(fileURLToPath(import.meta.url)), 'picture-ai-worker.mjs');

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There |This )/.test(cause.message) ? cause.message
  : 'The download failed. Check your connection and try again.';

/** Extracts the error message reported by `picture-ai-worker.mjs`, or a fallback. */
export function workerError(output) {
  const last = output.split(/\r?\n/).reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item?.stage === 'error');
  const message = typeof last?.message === 'string' ? last.message.trim().slice(0, 240) : '';
  return message || 'Local picture processing failed.';
}

/** Validates renderer input for a local background removal or upscale run. */
export function pictureAiInput(input, models = pictureAiModels) {
  if (!input || typeof input !== 'object') throw new Error('Invalid picture request.');
  const { operation, scale } = input;
  if (operation !== 'remove-background' && operation !== 'upscale') throw new Error('Unknown picture operation.');
  if (operation === 'upscale' && scale !== 2 && scale !== 4) throw new Error('Scale must be 2 or 4.');
  if (operation === 'remove-background' && scale !== undefined) throw new Error('Scale applies only to upscaling.');
  const model = models.find((item) => item.operation === operation);
  if (!model) throw new Error('Unknown picture operation.');
  const image = picture(input.image, ['png', 'jpeg', 'webp'], 'Select one PNG, JPEG or WebP picture of up to 20 MB.');
  const factor = operation === 'upscale' ? scale : 1;
  const outW = image.width * factor;
  const outH = image.height * factor;
  if (outW > maxOutputSide || outH > maxOutputSide || outW * outH > maxOutputPixels) {
    throw new Error(operation === 'upscale'
      ? `The upscaled picture (${outW}×${outH}) exceeds the ${maxOutputSide} px or 36 megapixel limit. Try ${scale === 4 ? '2× or ' : ''}a smaller picture.`
      : 'Picture exceeds the 8192 px or 36 megapixel limit for local processing.');
  }
  return { operation, scale, model, image };
}

/**
 * Local background removal and 2x/4x upscaling using CPU ONNX Runtime in a child process.
 * Pure CPU work: never unloads Ollama or blocks `gpuQueue`. Downloads happen only after user confirmation,
 * are verified against pinned SHA-256 hashes, and the renderer never passes file paths or commands.
 */
export function createPictureAi({
  dir,
  env = process.env,
  fetchImpl = fetch,
  spawnProcess = spawn,
  execPath = process.execPath,
  workerPath = defaultWorkerPath,
  models = pictureAiModels,
} = {}) {
  const modelsDir = join(dir, 'models');
  const outDir = join(dir, 'out');
  const modelFile = (model) => join(modelsDir, `${model.id}.onnx`);
  const partial = (model) => existsSync(modelFile(model)) ? 0 : partBytes(modelFile(model), model.sha256);
  const find = (id) => models.find((model) => model.id === id);

  async function install(state) {
    const { model } = state;
    const { signal } = state.controller;
    mkdirSync(modelsDir, { recursive: true });
    if (!existsSync(modelFile(model))) {
      state.received = 0;
      state.total = model.bytes;
      await downloadFile(fetchImpl, model.url, modelFile(model), { sha256: model.sha256, signal, onBytes: (n) => { state.received += n; } });
    }
  }

  const downloads = createDownloadQueue(install, failure);
  const runs = new Map();
  let queue = Promise.resolve();

  async function execute(runId, { operation, scale, model, image }, controller, onProgress) {
    controller.signal.throwIfAborted();
    const clear = (folder, maxRetries = 0) => { try { rmSync(folder, { recursive: true, force: true, maxRetries }); } catch { /* still in use */ } };
    clear(outDir);
    const runDir = join(outDir, runId);
    const inFile = join(runDir, `in.${image.ext}`);
    const outFile = join(runDir, 'out.png');
    try {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(inFile, image.bytes);
      let output = '';
      const args = [workerPath, operation, modelFile(model), inFile, outFile, ...(scale ? [String(scale)] : [])];
      const code = await new Promise((resolve, reject) => {
        const proc = spawnProcess(execPath, args, {
          env: { ...agentEnv(env), ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stop = () => { proc.kill(); clear(runDir); };
        controller.signal.addEventListener('abort', stop, { once: true });
        let pending = '';
        proc.stdout?.on('data', (chunk) => {
          output = (output + chunk).slice(-8000);
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event?.stage && event.stage !== 'error') onProgress?.(event);
            } catch { /* ignore non-json */ }
          }
        });
        proc.stderr?.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
        whenGone(proc).then((status) => {
          controller.signal.removeEventListener('abort', stop);
          resolve(status);
        }, () => reject(new Error('Local picture engine could not start.')));
      });
      if (controller.signal.aborted) throw new Error('Stopped.');
      if (code !== 0 || !existsSync(outFile)) throw new Error(workerError(output));
      return { image: `data:image/png;base64,${readFileSync(outFile).toString('base64')}`, model: model.id };
    } finally {
      clear(runDir, 5);
    }
  }

  return {
    supported: true,
    status() {
      const job = downloads.running;
      return {
        supported: true,
        downloading: job ? { id: job.id, name: job.name, received: Math.min(job.received, job.total), total: job.total } : null,
        queued: downloads.waiting,
        error: downloads.error,
        models: models.map((model) => ({
          id: model.id,
          operation: model.operation,
          name: model.name,
          quality: model.quality,
          note: model.note,
          license: model.license,
          source: model.source,
          bytes: model.bytes,
          installed: existsSync(modelFile(model)),
          partial: partial(model),
        })),
      };
    },
    download(id) {
      const model = find(id);
      if (!model) return false;
      return downloads.add({ id: model.id, name: model.name, model, received: 0, total: model.bytes });
    },
    cancelDownload(id) { return downloads.cancel(id); },
    remove(id) {
      const model = find(id);
      if (!model || downloads.has(id) || (runs.size && existsSync(modelFile(model)))) return false;
      rmSync(modelFile(model), { force: true });
      removeParts(modelFile(model));
      downloads.forget(id);
      return true;
    },
    run(runId, input, onProgress) {
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) return Promise.reject(new Error('Invalid picture run.'));
      let parsed;
      try { parsed = pictureAiInput(input, models); } catch (cause) { return Promise.reject(cause); }
      if (!existsSync(modelFile(parsed.model))) return Promise.reject(new Error(`Download ${parsed.model.name} in Settings → Local models first.`));
      const controller = new AbortController();
      runs.set(runId, controller);
      const task = queue.then(() => execute(runId, parsed, controller, onProgress));
      queue = task.catch(() => {});
      return task.finally(() => { runs.delete(runId); });
    },
    cancel(runId) { runs.get(runId)?.abort(); },
    stop() {
      downloads.stop();
      for (const controller of runs.values()) controller.abort();
    },
  };
}
