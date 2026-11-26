import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, win32 } from 'node:path';
import { agentEnv } from './agents.mjs';
import { createGpuQueue, whenGone } from './gpu-queue.mjs';
import { createDownloadQueue, downloadFile, extractZip, listParts, partBytes, removeParts } from './download.mjs';
import { namedFewStep, readCheckpoint } from './sd-header.mjs';
import { editDimensions, sdInput } from './sd-input.mjs';
import { checkpointSample, localModelId, newLocalModelId, readLocalCheckpoint, scanCheckpoints, validLocalRecord } from './sd-local.mjs';
import { aspectRatioOf, customModelId, defaultSdModel, encodeHfPath, hfFilePattern, hfRepoPattern, parseHuggingFace, sdDimensions, sdEngineUrl, sdEngines, sdModelUrl, sdModels, sdRelease } from './sd-models.mjs';
import { compatibleSdProfiles, findSdProfile, publicSdProfile, resolveSdProfile, sdProfiles } from './sd-profiles.mjs';

const binaryName = (platform) => platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';

const failure = (cause) => /ENOSPC/.test(String(cause?.code ?? cause)) ? 'There is not enough disk space.'
  : cause instanceof Error && /^(The |Could not |There |This |That )/.test(cause.message) ? cause.message
  : 'The download failed. Check your connection and try again.';

/** The last meaningful line the engine printed, for an error the user can act on. */
export function engineError(output) {
  const text = output.slice(-4000);
  if (/out[ _]?of[ _]?device[ _]?memory|cannot make enough memory available on Vulkan|failed during (?:allocated|workspace) capacity check/i.test(text)) return 'Graphics memory ran out. Close other apps that use the GPU or try a smaller image size.';
  if (/out of memory|failed to allocate|bad_alloc/i.test(text)) return 'Not enough memory for this model. Try a smaller model.';
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
  const localDir = join(dir, 'local');
  const presetIds = models.filter((model) => model.sample).map((model) => model.id);
  const modelFile = (model) => model.local ? model.path : model.custom ? join(customDir, `${model.id}${model.ext}`) : join(dir, 'models', `${model.id}.safetensors`);
  const metaFile = (id) => join(customDir, `${id}.json`);
  const localFile = (id) => join(localDir, `${id}.json`);
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
  const localModels = () => {
    try {
      return readdirSync(localDir).filter((name) => name.endsWith('.json')).flatMap((name) => {
        try {
          const record = JSON.parse(readFileSync(join(localDir, name), 'utf8'));
          if (!validLocalRecord(record, presetIds) || name !== `${record.id}.json` || !profile(record.family)) return [];
          const ext = extname(record.path);
          return [{ ...record, ext, name: basename(record.path, ext), quality: profile(record.family).name, note: 'From this computer', custom: true, local: true }];
        } catch { return []; }
      });
    } catch { return []; }
  };
  const allModels = () => {
    const local = localModels();
    return [...models.filter((model) => !local.some((item) => item.id === model.id)), ...customModels(), ...local];
  };
  /** Bytes of an unfinished download of `model`. */
  const partial = (model) => model.local || existsSync(modelFile(model)) ? 0 : partBytes(modelFile(model), model.sha256);
  /** The built-in model a Hugging Face file is, so it is not kept twice. */
  const preset = (repo, file) => models.find((model) => model.repo === repo && model.file === file);
  const find = (id) => allModels().find((model) => model.id === (id ?? defaultSdModel));

  /** Single-file checkpoints with the size and SHA-256 Hugging Face reports. */
  async function listFiles(repo, file, signal = AbortSignal.timeout(15_000)) {
    if (typeof repo !== 'string' || !hfRepoPattern.test(repo)) throw new Error('Enter a Hugging Face model as owner/name.');
    if (file !== undefined && (typeof file !== 'string' || !hfFilePattern.test(file))) throw new Error('That file was not found in the model.');
    const folder = file && dirname(file).replaceAll('\\', '/');
    const tree = `https://huggingface.co/api/models/${repo}/tree/main${folder && folder !== '.' ? `/${encodeHfPath(folder)}` : ''}`;
    let url = file ? tree : `${tree}?recursive=true`;
    const files = [];
    for (let page = 0; url && page < 4; page++) {
      let response;
      try { response = await fetchImpl(url, { signal }); } catch { throw new Error('Could not reach Hugging Face.'); }
      const final = new URL(response.url || url);
      if (final.origin !== 'https://huggingface.co' || final.username || final.password) {
        await response.body?.cancel();
        throw new Error('Could not reach Hugging Face.');
      }
      if (response.status === 404) throw new Error('That model or folder was not found on Hugging Face.');
      if (response.status === 401 || response.status === 403) throw new Error('That model was not found, or it needs a Hugging Face login, which Lomra does not support.');
      if (!response.ok) throw new Error('Could not reach Hugging Face.');
      const items = await response.json().catch(() => []);
      for (const item of Array.isArray(items) ? items.slice(0, 1000) : []) {
        if (item?.type !== 'file' || typeof item.path !== 'string' || !hfFilePattern.test(item.path)
          || !/^[a-f0-9]{64}$/.test(item.lfs?.oid ?? '') || !Number.isSafeInteger(item.size) || item.size <= 0 || (file && item.path !== file)) continue;
        files.push({ id: preset(repo, item.path)?.id ?? customModelId(repo, item.path), file: item.path, bytes: item.size, sha256: item.lfs.oid });
        if (file || files.length === 50) return files;
      }
      const next = response.headers?.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      const parsed = next && URL.canParse(next, final) && new URL(next, final);
      url = parsed && parsed.origin === final.origin && parsed.pathname === final.pathname && !parsed.username && !parsed.password ? parsed.href : null;
    }
    return files;
  }
  const downloads = createDownloadQueue(install, failure);
  const runs = new Map();
  /** Graphics memory in bytes, once known; 0 when it cannot be found out. */
  let gpuBytes = 0;
  let probing;
  /** Header classification (`{ supported, inpaint, headerType }`) cached once per installed custom model. */
  const headers = new Map();
  const localHeaders = new Map();
  const candidates = new Map();
  let selection = 0;

  function writeLocal(id, { path, bytes, mtimeMs }, family) {
    mkdirSync(localDir, { recursive: true });
    const temp = `${localFile(id)}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ id, path, bytes, mtimeMs, family }));
      renameSync(temp, localFile(id));
    } finally { rmSync(temp, { force: true }); }
  }

  async function checkLocal(model) {
    const info = await stat(model.path).catch(() => null);
    if (!info?.isFile()) {
      const result = { state: 'missing' };
      localHeaders.set(model.id, result);
      return result;
    }
    const stamp = `${model.path}\0${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const cached = localHeaders.get(model.id);
    if (cached?.stamp === stamp) return cached;
    const found = await readLocalCheckpoint(model.path).catch(() => null);
    const result = { stamp, state: found ? 'ready' : 'changed', found };
    localHeaders.set(model.id, result);
    return result;
  }

  const compatible = (found, family) => compatibleSdProfiles(found.header, profiles).some((item) => item.id === family);
  const localState = (model, result) => result?.state === 'ready' && !compatible(result.found, model.family) ? 'changed' : result?.state;

  async function duplicate(found, sample, except) {
    const sameSize = allModels().filter((model) => model.id !== except && (model.local || model.bytes === found.bytes));
    for (const model of sameSize) {
      const path = modelFile(model);
      if (path === found.resolved || path === found.path) return true;
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || info.size !== found.bytes) continue;
      if (sample && sample === await checkpointSample(path, found.bytes).catch(() => null)) return true;
    }
    return false;
  }

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
    if (!model.local && !existsSync(modelFile(model))) {
      if (model.custom) {
        // The size and hash come from Hugging Face's own listing, so a corrupted download is still caught.
        const [info] = await listFiles(model.repo, model.file, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
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
    let checkpointPath = modelFile(model);
    if (model.local) {
      const result = await checkLocal(model);
      if (localState(model, result) !== 'ready') throw new Error('The checkpoint is missing or changed. Open Settings → Local models to locate it or update its profile.');
      const { found } = result;
      // The pinned Windows engine needs the extended-length path form once MAX_PATH is reached.
      checkpointPath = platform === 'win32' && found.resolved.length >= 260 ? win32.toNamespacedPath(found.resolved) : found.resolved;
      if (found.bytes !== model.bytes || found.mtimeMs !== model.mtimeMs) {
        const current = localModels().find((item) => item.id === model.id);
        if (current?.path === model.path) {
          try { writeLocal(model.id, found, current.family); }
          catch { throw new Error('Could not update the checkpoint record.'); }
        }
      }
      controller.signal.throwIfAborted();
    }
    const outDir = join(dir, 'out');
    // Best effort: what the engine still holds goes with the next run, since only one runs at a time.
    const clear = (folder, maxRetries = 0) => { try { rmSync(folder, { recursive: true, force: true, maxRetries }); } catch { /* still in use */ } };
    clear(outDir);
    const runDir = join(outDir, runId);
    const out = join(runDir, 'out.png');
    const { width, height } = image ? editDimensions(aspectRatio ? aspectRatioOf(aspectRatio) : image.width / image.height, resolvedProfile.size) : sdDimensions(aspectRatio, resolvedProfile.size);
    const args = ['-m', checkpointPath, '-p', prompt, '-o', out, '-W', String(width), '-H', String(height), '--steps', String(settings.steps), '--cfg-scale', String(settings.cfg), '-s', String(settings.seed)];
    // Windows Vulkan can report other apps' VRAM as free. Leave headroom so auto-fit splits the SDXL UNet.
    if (platform === 'win32' && (model.id === 'sdxl-turbo' || (model.custom && resolvedProfile.headerTypes.includes('sdxl')))) {
      args.push('--max-vram', '-3', '--mmap');
    }
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
      if (code !== 0 || !existsSync(out)) {
        const message = engineError(output);
        throw new Error(model.local && message.startsWith('Image generation failed')
          ? 'The image engine could not run this checkpoint. Check that the drive is connected and the file is readable.' : message);
      }
      return { image: `data:image/png;base64,${readFileSync(out).toString('base64')}`, settings };
    } catch (cause) {
      if (model.local && cause?.path) throw new Error('The image engine could not access its files.');
      throw cause;
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
          const local = model.local && localHeaders.get(model.id);
          const state = model.local ? localState(model, local) ?? 'missing' : undefined;
          const installed = model.local ? state === 'ready' && existsSync(exe) : existsSync(modelFile(model));
          const resolved = modelProfile(model);
          const header = model.local ? local?.found?.header : headers.get(model.id);
          return {
            id: model.id, name: model.name, quality: model.quality, note: model.note, bytes: local?.found?.bytes ?? model.bytes,
            recommended: !!model.default, installed, partial: partial(model), custom: !!model.custom,
            ...(model.local ? { local: true, localState: state } : {}),
            inpaint: header?.inpaint ?? false,
            profile: publicSdProfile(resolved),
            ...(model.custom && (installed || header) ? {
              compatibleProfiles: compatibleSdProfiles(header, profiles).map((item) => item.id),
            } : {}),
          };
        }).filter((model) => model.local || !model.custom || model.installed || model.partial),
      };
    },
    /** Finds out what `status()` cannot read at once: the graphics memory and which added models are made for inpainting. Never rejects. */
    async probe() {
      probing ??= gpuMemory().then((bytes) => { gpuBytes = Number.isFinite(bytes) ? bytes : 0; }, () => {});
      await Promise.all([probing, ...localModels().map(checkLocal), ...customModels().filter((model) => !headers.has(model.id) && existsSync(modelFile(model))).map(async (model) => {
        headers.set(model.id, await probeFile(model).catch(() => ({ supported: true, inpaint: false, headerType: null })));
      })]);
    },
    canLocate(id) { return typeof id === 'string' && localModels().some((item) => item.id === id); },
    async pickLocal(path, folder, replace) {
      const current = ++selection;
      candidates.clear();
      const target = replace && localModels().find((model) => model.id === replace);
      if (!engine || (replace && !target)) return { files: [], limited: false };
      const scan = folder ? await scanCheckpoints(path) : { files: [path] };
      const publicFiles = [];
      for (const file of scan.files) {
        const candidate = await readLocalCheckpoint(file, scan.root).catch((cause) => { if (!folder) throw cause; return null; });
        if (current !== selection) return { files: [], limited: false };
        if (!candidate) continue;
        const id = newLocalModelId();
        candidates.set(id, { ...candidate, root: scan.root, replace });
        const { label, inpaint, fewStep, family, fewStepFamily } = candidate.header;
        publicFiles.push({ id, name: basename(file), bytes: candidate.bytes, label, inpaint, family,
          suggestedProfile: fewStep ? fewStepFamily : family,
          compatibleProfiles: compatibleSdProfiles(candidate.header, profiles).map((item) => item.id) });
      }
      return { files: publicFiles, limited: !!scan.limited };
    },
    async addLocal(id, family, downloadEngine) {
      if (typeof id !== 'string' || !localModelId.test(id) || typeof family !== 'string' || !profile(family) || typeof downloadEngine !== 'boolean') throw new Error('Choose a checkpoint and a compatible profile.');
      const candidate = candidates.get(id);
      if (!candidate) throw new Error('Choose the checkpoint again.');
      candidates.delete(id);
      const found = await readLocalCheckpoint(candidate.path, candidate.root);
      if (found.resolved !== candidate.resolved || found.bytes !== candidate.bytes || found.mtimeMs !== candidate.mtimeMs) throw new Error('The checkpoint changed. Choose it again.');
      if (!compatible(found, family)) throw new Error('Choose a profile compatible with this checkpoint.');
      const sample = await checkpointSample(found.resolved, found.bytes).catch(() => null);
      const builtIn = models.find((model) => model.bytes === found.bytes && model.sample && model.sample === sample);
      if (candidate.replace && (presetIds.includes(candidate.replace) || builtIn) && candidate.replace !== builtIn?.id) throw new Error('Choose the original checkpoint file for this model.');
      if (await duplicate(found, sample, candidate.replace)) throw new Error('This checkpoint is already in Lomra.');
      const modelId = candidate.replace ?? builtIn?.id ?? id;
      if (candidate.replace && (runs.size || downloads.has(modelId) || !localModels().some((model) => model.id === modelId))) throw new Error('The model cannot be located right now.');
      if (!candidate.replace && builtIn && (downloads.has(modelId) || existsSync(modelFile(builtIn)))) throw new Error('This checkpoint is already in Lomra.');
      if (localModels().some((model) => (!candidate.replace || model.id !== modelId) && (model.id === modelId || model.path === found.path))) throw new Error('This checkpoint is already in Lomra.');
      writeLocal(modelId, found, family);
      const model = localModels().find((item) => item.id === modelId);
      await checkLocal(model);
      if (downloadEngine && !existsSync(exe)) this.download(modelId);
      return true;
    },
    inspect,
    /** Updates the profile of an installed Hugging Face model when it is compatible with the file's header. */
    async setProfile(id, profileId) {
      if (typeof id !== 'string' || typeof profileId !== 'string') return false;
      const local = localModels().find((item) => item.id === id);
      if (local) {
        const { found } = await checkLocal(local);
        if (!found || !compatible(found, profileId) || !localModels().some((item) => item.id === id && item.path === local.path)) return false;
        writeLocal(id, found, profileId);
        return true;
      }
      const model = customModels().find((item) => item.id === id);
      if (!model || !existsSync(modelFile(model)) || downloads.has(id)) return false;
      const next = profile(profileId);
      if (!next) return false;
      if (!headers.has(id)) headers.set(id, await probeFile(model).catch(() => ({ supported: true, inpaint: false, headerType: null })));
      const header = headers.get(id);
      if (!compatibleSdProfiles(header, profiles).some((item) => item.id === next.id)) return false;
      const path = metaFile(model.id);
      const existing = JSON.parse(readFileSync(path, 'utf8'));
      const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify({ ...existing, id: model.id, repo: model.repo, file: model.file, family: next.id, bytes: model.bytes, sha256: model.sha256 }));
        renameSync(temp, path);
      } catch (cause) {
        rmSync(temp, { force: true });
        throw cause;
      }
      return true;
    },
    /** Downloads the engine (if missing) and a model in the background, after the ones already waiting; progress is in `status()`. Continues an unfinished download. */
    download(request) {
      let model;
      if (request && typeof request === 'object') {
        const kind = profile(request.family);
        if (!kind || typeof request.repo !== 'string' || typeof request.file !== 'string' || !hfRepoPattern.test(request.repo) || !hfFilePattern.test(request.file)) return false;
        const ext = extname(request.file).toLowerCase();
        const builtIn = preset(request.repo, request.file);
        if (builtIn && find(builtIn.id)?.local) return false;
        model = builtIn ?? { id: customModelId(request.repo, request.file), name: request.file.slice(0, -ext.length), custom: true, repo: request.repo, file: request.file, family: kind.id, profile: kind.id, ext, bytes: 0 };
      } else model = find(request);
      if (!engine || !model) return false;
      return downloads.add({ id: model.id, name: model.name, model, stage: 'engine', received: 0, total: 0 });
    },
    /** Single-file checkpoints of a Hugging Face repository (`owner/name`). Rejects with a message the user can read. */
    files(repo, file) { return listFiles(repo, file); },
    /**
     * `{ repo, file? }` when `query` is a Hugging Face `owner/name` or link, else the text-to-image models
     * matching it that have a usable file, most downloaded first.
     */
    async search(query) {
      if (typeof query !== 'string' || !query.trim() || query.length > 1800) throw new Error('Enter something to search for.');
      const direct = query.includes('/') ? parseHuggingFace(query) : null;
      if (direct) return { ...direct, models: [] };
      if (query.includes('://')) throw new Error('Enter a supported Hugging Face model or checkpoint link.');
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
      if (!model || downloads.has(id) || (runs.size && (model.local || existsSync(modelFile(model))))) return false;
      if (model.local) {
        rmSync(localFile(id), { force: true });
        localHeaders.delete(id);
      } else {
        rmSync(modelFile(model), { force: true });
        removeParts(modelFile(model));
        headers.delete(id);
        if (model.custom) rmSync(metaFile(model.id), { force: true });
      }
      downloads.forget(id);
      const holds = (folder) => existsSync(folder) && readdirSync(folder).some((file) => /\.(?:safetensors|gguf)(?:\.[a-f0-9]{16}\.part)?$/.test(file));
      const left = holds(join(dir, 'models')) || holds(customDir) || localModels().length;
      if (!left && downloads.idle && !runs.size) rmSync(engineRoot, { recursive: true, force: true });
      return true;
    },
    /** Makes one image: `{ image, settings }` with the seed and settings used. Rejects with a message the user can read; `gpuQueue` runs one at a time. */
    generate(runId, input, onProgress) {
      const model = input && typeof input === 'object' ? allModels().find((item) => item.id === input.model) : undefined;
      if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId) || runs.has(runId)) return Promise.reject(new Error('Invalid image run.'));
      if (model?.local && !existsSync(exe)) return Promise.reject(new Error('Download the image engine in Settings → Local models first.'));
      if (!model || !engine || !existsSync(exe) || (!model.local && !existsSync(modelFile(model)))) return Promise.reject(new Error('Download this model in Settings → Local models first.'));
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
