import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { agentEnv } from './agents.mjs';
import { createGpuQueue, whenGone } from './gpu-queue.mjs';
import { createDownloadQueue, downloadFile, extractZip, listParts, partBytes, removeParts } from './download.mjs';
import { namedFewStep, readCheckpoint } from './sd-header.mjs';
import { editDimensions, sdInput } from './sd-input.mjs';
import { aspectRatioOf, customModelId, defaultSdModel, hfFilePattern, hfRepoPattern, parseHuggingFace, sdDimensions, sdEngineUrl, sdEngines, sdModelUrl, sdModels, sdRelease } from './sd-models.mjs';
import { compatibleSdProfiles, findSdProfile, publicSdProfile, resolveSdProfile, sdProfiles } from './sd-profiles.mjs';

const binaryName = (platform) => platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There |This |That )/.test(cause.message) ? cause.message
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
 * name a model id and send prompts, an aspect ratio, a few bounded numbers and picture bytes (`sd-input.mjs` checks
 * them); it never supplies a path or a command line.
 */
export function createSd({ dir, platform = process.platform, arch = process.arch, env = process.env, fetchImpl = fetch, spawnProcess = spawn, extract = extractZip, models = sdModels, profiles = sdProfiles, engines = sdEngines, gpuQueue = createGpuQueue(), gpuMemory = async () => 0 } = {}) {
  const engine = engines[`${platform}-${arch}`];
  const engineRoot = join(dir, 'engine');
  const engineDir = join(engineRoot, sdRelease);
  const exe = join(engineDir, binaryName(platform));
  const customDir = join(dir, 'custom');
  const modelFile = (model) => model.custom ? join(customDir, `${model.id}${model.ext}`) : join(dir, 'models', `${model.id}.safetensors`);
  const metaFile = (id) => join(customDir, `${id}.json`);
  const profile = (id) => findSdProfile(id, profiles);
  const modelProfile = (model) => resolveSdProfile(model, profiles);
  /** A model the user added from Hugging Face, rebuilt from the record saved next to its weights. */
  const fromRecord = (record) => {
    const kind = profile(record?.family);
    if (!kind || ![record.id, record.repo, record.file, record.sha256].every((value) => typeof value === 'string') || !hfRepoPattern.test(record.repo) || !hfFilePattern.test(record.file) || record.id !== customModelId(record.repo, record.file) || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isFinite(record.bytes)) return undefined;
    const ext = extname(record.file).toLowerCase();
    return { id: record.id, name: record.file.slice(0, -ext.length), quality: kind.name, note: record.repo, bytes: record.bytes, custom: true, repo: record.repo, file: record.file, family: kind.id, profile: kind.id, sha256: record.sha256, ext };
  };
  const customModels = () => {
    try {
      return readdirSync(customDir).filter((name) => name.endsWith('.json')).flatMap((name) => {
        try { return fromRecord(JSON.parse(readFileSync(join(customDir, name), 'utf8'))) ?? []; } catch { return []; }
      });
    } catch { return []; }
  };
  const allModels = () => [...models, ...customModels()];
  /** Bytes of an unfinished download of `model`. */
  const partial = (model) => existsSync(modelFile(model)) ? 0 : partBytes(modelFile(model), model.sha256);
  /** The built-in model a Hugging Face file is, so it is not kept twice. */
  const preset = (repo, file) => models.find((model) => model.repo === repo && model.file === file);
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
      ? [{ id: preset(repo, item.path)?.id ?? customModelId(repo, item.path), file: item.path, bytes: item.size, sha256: item.lfs.oid }] : []).slice(0, 50);
  }
  const downloads = createDownloadQueue(install, failure);
  const runs = new Map();
  /** Graphics memory in bytes, once known; 0 when it cannot be found out. */
  let gpuBytes = 0;
  let probing;
  /** Header classification (`{ supported, inpaint, headerType }`) cached once per installed custom model. */
  const headers = new Map();

  /** What a Hugging Face checkpoint is, read from its first bytes without downloading it; `known` is false when they cannot be read. */
  async function inspect(repo, file) {
    if (typeof repo !== 'string' || !hfRepoPattern.test(repo) || typeof file !== 'string' || !hfFilePattern.test(file)) throw new Error('That file was not found in the model.');
    const signal = AbortSignal.timeout(20_000);
    let refused = false;
    const read = async (start, length) => {
      const response = await fetchImpl(sdModelUrl({ repo, file }), { headers: { range: `bytes=${start}-${start + length - 1}`, 'accept-encoding': 'identity' }, signal });
      if (response.status !== 206) {
        refused = response.status === 401 || response.status === 403;
        await response.body?.cancel();
        throw new Error('No partial content');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > length) throw new Error('Too much content');
      return bytes;
    };
    let found;
    try { found = await readCheckpoint(extname(file).toLowerCase(), read); } catch {
      if (refused) throw new Error('This model needs a Hugging Face login, which Lomra does not support.');
      return { known: false };
    }
    if (!found.supported) return { known: true, supported: false };
    // SDXL Turbo itself draws at 512 px; the other few-step SDXL models keep SDXL's 1024 px.
    const fewStepFamily = found.family === 'sdxl' && !/sd_?xl[-_]?turbo/i.test(file) ? 'sdxl-few' : 'turbo';
    return { known: true, supported: true, label: found.label, inpaint: found.inpaint, family: found.family, fewStepFamily, fewStep: namedFewStep(`${repo}/${file}`) };
  }

  async function probeFile(model) {
    const handle = await open(modelFile(model), 'r');
    try {
      const found = await readCheckpoint(model.ext, async (start, length) => {
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, start);
        return buffer.subarray(0, bytesRead);
      });
      return found.supported ? { supported: true, inpaint: found.inpaint, headerType: found.family } : { supported: false, inpaint: false, headerType: null };
    } finally { await handle.close(); }
  }

  async function install(state) {
    let { model } = state;
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
        await extract(zip, unpack, { platform, env, spawnProcess }, 'the image engine');
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
        const info = (await listFiles(model.repo, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))).find((item) => item.file === model.file);
        if (!info) throw new Error('That file was not found in the model.');
        model = { ...model, bytes: info.bytes, sha256: info.sha256 };
        // Saved before the download, so that it can be continued after a restart.
        writeFileSync(metaFile(model.id), JSON.stringify({ id: model.id, repo: model.repo, file: model.file, family: model.family, bytes: model.bytes, sha256: model.sha256 }));
      }
      state.stage = 'model';
      state.received = 0;
      state.total = model.bytes;
      try {
        await downloadFile(fetchImpl, sdModelUrl(model), modelFile(model), { sha256: model.sha256, signal, onBytes: (n) => { state.received += n; } });
        if (model.custom) headers.delete(model.id);
      } finally {
        if (model.custom && !existsSync(modelFile(model)) && !listParts(modelFile(model)).length) rmSync(metaFile(model.id), { force: true });
      }
    }
  }

  async function execute(runId, model, resolvedProfile, { prompt, aspectRatio, image, mask, settings }, controller, onProgress) {
    controller.signal.throwIfAborted();
    const outDir = join(dir, 'out');
    // Best effort: what the engine still holds goes with the next run, since only one runs at a time.
    const clear = (folder, maxRetries = 0) => { try { rmSync(folder, { recursive: true, force: true, maxRetries }); } catch { /* still in use */ } };
    clear(outDir);
    const runDir = join(outDir, runId);
    const out = join(runDir, 'out.png');
    const { width, height } = image ? editDimensions(aspectRatio ? aspectRatioOf(aspectRatio) : image.width / image.height, resolvedProfile.size) : sdDimensions(aspectRatio, resolvedProfile.size);
    const args = ['-m', modelFile(model), '-p', prompt, '-o', out, '-W', String(width), '-H', String(height), '--steps', String(settings.steps), '--cfg-scale', String(settings.cfg), '-s', String(settings.seed)];
    // Tiling saves memory but shifts colors from tile to tile, which shows as a seam around an edited area.
    if (!image || width * height > 512 * 512) args.push('--vae-tiling');
    if (settings.negativePrompt) args.push('-n', settings.negativePrompt);
    const files = [];
    const add = (flag, target, source, mode) => {
      const file = join(runDir, `${target}.${source.ext}`);
      files.push([file, source.bytes]);
      args.push(flag, file, '--image-preprocess', `target=${target},mode=${mode}`);
    };
    // Stretching to the nearest size the engine keeps shows it the whole picture, and the caller stretches the result
    // back. Another aspect ratio is a centre crop.
    if (image) add('-i', 'init', image, `${aspectRatio ? 'crop-resize' : 'stretch'},filter=bicubic,antialias=true`);
    if (mask) add('--mask', 'mask', mask, 'stretch');
    if (image && settings.strength !== undefined) args.push('--strength', String(settings.strength));
    try {
      mkdirSync(runDir, { recursive: true });
      for (const [file, bytes] of files) writeFileSync(file, bytes);
      let output = '';
      let sampling = !image;
      let sampled = false;
      const code = await new Promise((resolve, reject) => {
        const proc = spawnProcess(exe, args, { cwd: engineDir, env: agentEnv(env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const stop = () => { proc.kill(); clear(runDir); };
        controller.signal.addEventListener('abort', stop, { once: true });
        const read = (chunk) => {
          output = (output + chunk).slice(-8000);
          // Only the sampling steps; the engine prints the same counter for encoding the source and decoding the image.
          const text = String(chunk);
          const start = text.lastIndexOf('generating image:');
          const end = text.indexOf('sampling completed');
          if (start >= 0) sampling = true;
          if (!sampling || sampled) return;
          if (end >= 0) sampled = true;
          const steps = [...text.slice(Math.max(start, 0), end < 0 ? undefined : end).matchAll(/(\d+)\/(\d+)\s*-\s*[\d.]+\s*(?:s\/it|it\/s)/g)].pop();
          // A source picture is redrawn in fewer steps than asked, so its total is the engine's own.
          if (steps && (image || Number(steps[2]) === settings.steps)) onProgress?.({ step: Number(steps[1]), total: Number(steps[2]) });
        };
        proc.stdout?.on('data', read);
        proc.stderr?.on('data', read);
        whenGone(proc).then((status) => { controller.signal.removeEventListener('abort', stop); resolve(status); }, () => reject(new Error('The image engine could not start.')));
      });
      if (controller.signal.aborted) throw new Error('Stopped.');
      if (code !== 0 || !existsSync(out)) throw new Error(engineError(output));
      return { image: `data:image/png;base64,${readFileSync(out).toString('base64')}`, settings };
    } finally {
      clear(runDir, 5);
    }
  }

  return {
    supported: !!engine,
    status() {
      const job = downloads.running;
      return {
        supported: !!engine,
        engine: !!engine && existsSync(exe),
        engineBytes: engine?.bytes ?? 0,
        downloading: job ? { id: job.id, name: job.name, stage: job.stage, received: Math.min(job.received, job.total), total: job.total } : null,
        queued: downloads.waiting,
        error: downloads.error,
        gpuBytes,
        profiles: profiles.map((item) => publicSdProfile(resolveSdProfile(item, profiles))),
        models: allModels().map((model) => {
          const installed = existsSync(modelFile(model));
          const resolved = modelProfile(model);
          const header = headers.get(model.id);
          return {
            id: model.id, name: model.name, quality: model.quality, note: model.note, bytes: model.bytes,
            recommended: !!model.default, installed, partial: partial(model), custom: !!model.custom,
            inpaint: header?.inpaint ?? false,
            profile: publicSdProfile(resolved),
            ...(model.custom && installed ? {
              compatibleProfiles: compatibleSdProfiles(header, profiles).map((item) => item.id),
            } : {}),
          };
        }).filter((model) => !model.custom || model.installed || model.partial),
      };
    },
    /** Finds out what `status()` cannot read at once: the graphics memory and which added models are made for inpainting. Never rejects. */
    async probe() {
      probing ??= gpuMemory().then((bytes) => { gpuBytes = Number.isFinite(bytes) ? bytes : 0; }, () => {});
      await Promise.all([probing, ...customModels().filter((model) => !headers.has(model.id) && existsSync(modelFile(model))).map(async (model) => {
        headers.set(model.id, await probeFile(model).catch(() => ({ supported: true, inpaint: false, headerType: null })));
      })]);
    },
    inspect,
    /** Updates the profile of an installed Hugging Face model when it is compatible with the file's header. */
    async setProfile(id, profileId) {
      if (typeof id !== 'string' || typeof profileId !== 'string') return false;
      const model = customModels().find((item) => item.id === id);
      if (!model || !existsSync(modelFile(model)) || downloads.has(id)) return false;
      const next = profile(profileId);
      if (!next) return false;
      if (!headers.has(id)) headers.set(id, await probeFile(model).catch(() => ({ supported: true, inpaint: false, headerType: null })));
      const header = headers.get(id);
      if (!compatibleSdProfiles(header, profiles).some((item) => item.id === next.id)) return false;
      writeFileSync(metaFile(model.id), JSON.stringify({ id: model.id, repo: model.repo, file: model.file, family: next.id, bytes: model.bytes, sha256: model.sha256 }));
      return true;
    },
    /** Downloads the engine (if missing) and a model in the background, after the ones already waiting; progress is in `status()`. Continues an unfinished download. */
    download(request) {
      let model;
      if (request && typeof request === 'object') {
        const kind = profile(request.family);
        if (!kind || typeof request.repo !== 'string' || typeof request.file !== 'string' || !hfRepoPattern.test(request.repo) || !hfFilePattern.test(request.file)) return false;
        const ext = extname(request.file).toLowerCase();
        model = preset(request.repo, request.file) ?? { id: customModelId(request.repo, request.file), name: request.file.slice(0, -ext.length), custom: true, repo: request.repo, file: request.file, family: kind.id, profile: kind.id, ext, bytes: 0 };
      } else model = find(request);
      if (!engine || !model) return false;
      return downloads.add({ id: model.id, name: model.name, model, stage: 'engine', received: 0, total: 0 });
    },
    /** Single-file checkpoints of a Hugging Face repository (`owner/name`). Rejects with a message the user can read. */
    files(repo) { return listFiles(repo); },
    /**
     * `{ repo, file? }` when `query` is a Hugging Face `owner/name` or link, else the text-to-image models
     * matching it that have a usable file, most downloaded first.
     */
    async search(query) {
      if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Enter something to search for.');
      const direct = query.includes('/') ? parseHuggingFace(query) : null;
      if (direct) return { ...direct, models: [] };
      if (query.length > 100) throw new Error('Enter something to search for.');
      let response;
      try { response = await fetchImpl(`https://huggingface.co/api/models?${new URLSearchParams({ search: query.trim(), filter: 'text-to-image', sort: 'downloads', limit: '40', full: 'true' })}`, { signal: AbortSignal.timeout(15_000) }); } catch { throw new Error('Could not reach Hugging Face.'); }
      if (!response.ok) throw new Error('Could not reach Hugging Face.');
      const items = await response.json().catch(() => []);
      // Gated repositories need a login, and a repository without a single-file checkpoint at its top has nothing to offer.
      return { models: (Array.isArray(items) ? items : []).flatMap((item) => {
        if (typeof item?.id !== 'string' || !hfRepoPattern.test(item.id) || item.gated) return [];
        const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [];
        // Marked as adult by its author; a pasted link still opens it.
        if (tags.includes('not-for-all-audiences')) return [];
        // Add-ons to a checkpoint, not checkpoints.
        if (/control-?net|\blora\b/i.test(item.id.replaceAll('_', '-')) || tags.some((tag) => /^(?:lora|controlnet)$/i.test(tag))) return [];
        if (!Array.isArray(item.siblings) || !item.siblings.some((file) => hfFilePattern.test(file?.rfilename ?? ''))) return [];
        const license = tags.map((tag) => /^license:([\w.+-]{1,60})$/.exec(tag)?.[1]).find(Boolean);
        return [{ id: item.id, downloads: Number(item.downloads) || 0, ...(license && { license }) }];
      }).slice(0, 15) };
    },
    /** Stops the download of one model, or the running one; what was downloaded is kept. */
    cancelDownload(id) { return downloads.cancel(id); },
    /** Deletes a model or its unfinished download; the engine goes with the last one. */
    remove(id) {
      const model = allModels().find((item) => item.id === id);
      // Which model an image is being made with is not known here, so installed ones stay until it is done.
      if (!model || downloads.has(id) || (runs.size && existsSync(modelFile(model)))) return false;
      rmSync(modelFile(model), { force: true });
      removeParts(modelFile(model));
      downloads.forget(id);
      headers.delete(id);
      if (model.custom) rmSync(metaFile(model.id), { force: true });
      const holds = (folder) => existsSync(folder) && readdirSync(folder).some((file) => /\.(?:safetensors|gguf)(?:\.[a-f0-9]{16}\.part)?$/.test(file));
      const left = holds(join(dir, 'models')) || holds(customDir);
      if (!left && downloads.idle && !runs.size) rmSync(engineRoot, { recursive: true, force: true });
      return true;
    },
    /** Makes one image: `{ image, settings }` with the seed and settings used. Rejects with a message the user can read; `gpuQueue` runs one at a time. */
    generate(runId, input, onProgress) {
      const model = input && typeof input === 'object' ? allModels().find((item) => item.id === input.model) : undefined;
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) return Promise.reject(new Error('Invalid image run.'));
      if (!model || !engine || !existsSync(exe) || !existsSync(modelFile(model))) return Promise.reject(new Error('Download this model in Settings → Local models first.'));
      const resolved = modelProfile(model);
      let request;
      try { request = sdInput(input, resolved); } catch (cause) { return Promise.reject(cause); }
      const controller = new AbortController();
      runs.set(runId, controller);
      const run = gpuQueue.run(() => execute(runId, model, resolved, request, controller, onProgress), {
        signal: controller.signal, onWait: (waiting) => onProgress?.({ step: 0, total: request.settings.steps, waiting }),
      });
      return run.finally(() => { runs.delete(runId); });
    },
    cancel(runId) { runs.get(runId)?.abort(); },
    stop() {
      downloads.stop();
      for (const controller of runs.values()) controller.abort();
    },
  };
}
