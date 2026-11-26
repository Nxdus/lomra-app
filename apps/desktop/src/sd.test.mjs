import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { engineError, createSd } from './sd.mjs';
import { editDimensions, imageSize, sdInput } from './sd-input.mjs';
import { sdDimensions, sdEngines, sdModels, sdModelUrl } from './sd-models.mjs';
import { checkpointSample } from './sd-local.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
// realpath: Windows runners give tmpdir() as an 8.3 short path, but checkpoint paths are canonical.
const tempDir = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'lomra-sd-')));
const runId = '11111111-1111-1111-1111-111111111111';
const wait = async (until) => { for (let i = 0; i < 200 && !until(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); };

const engineBody = 'engine-zip';
const modelBody = 'model-weights';
const models = [{ id: 'tiny', name: 'Tiny', quality: 'Fast', note: '', file: 'tiny.safetensors', repo: 'a/b', sha256: sha(modelBody), bytes: modelBody.length, size: 512, steps: 4, cfg: 1, default: true }];
const engines = { 'win32-x64': { asset: 'engine.zip', sha256: sha(engineBody), bytes: engineBody.length } };

function fakeFetch(bodies = {}) {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const body = String(url).endsWith('engine.zip') ? bodies.engine ?? engineBody : bodies.model ?? modelBody;
    return new Response(Readable.toWeb(Readable.from([Buffer.from(body)])), { status: 200 });
  };
  return { fetchImpl, seen };
}

const fakeExtract = async (_zip, dest) => { writeFileSync(join(dest, 'sd-cli.exe'), 'binary'); };

function make(overrides = {}) {
  const dir = tempDir();
  const sd = createSd({ dir, platform: 'win32', arch: 'x64', env: { LOMRA_SECRET: 'x', PATH: '/bin' }, models, engines, extract: fakeExtract, ...overrides });
  return { sd, dir };
}

test('sdDimensions keeps the long side and snaps to multiples of 8', () => {
  expect(sdDimensions('1:1', 512)).toEqual({ width: 512, height: 512 });
  expect(sdDimensions('16:9', 512)).toEqual({ width: 512, height: 288 });
  expect(sdDimensions('9:16', 512)).toEqual({ width: 288, height: 512 });
  expect(sdDimensions('nonsense', 512)).toEqual({ width: 512, height: 512 });
  expect(sdDimensions('1:100', 512).width).toBeGreaterThanOrEqual(64);
});

test('pinned models and engines carry a hash and a size', () => {
  for (const item of [...sdModels, ...Object.values(sdEngines)]) {
    expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(item.bytes).toBeGreaterThan(0);
  }
  expect(sdModels.filter((model) => model.default)).toHaveLength(1);
});

test('engineError turns engine output into a readable message', () => {
  const gpuMemory = 'Graphics memory ran out. Close other apps that use the GPU or try a smaller image size.';
  expect(engineError('ggml_vulkan: ErrorOutOfDeviceMemory')).toBe(gpuMemory);
  expect(engineError('[W] execution engine cannot make enough memory available on Vulkan0: need 512.00 MB device / 60.67 MB budget, available 379.11 MB device / 1860.93 MB budget --- execution_engine.cpp:947')).toBe(gpuMemory);
  expect(engineError('[E] unet segment 1/1 (graph) failed during allocated capacity check --- execution_engine.cpp:596')).toBe(gpuMemory);
  expect(engineError('[ERROR] bad model file')).toContain('bad model file');
  expect(engineError('')).toBe('Image generation failed.');
});

test('an unsupported computer cannot download', () => {
  const { sd } = make({ platform: 'freebsd' });
  expect(sd.status().supported).toBe(false);
  expect(sd.download('tiny')).toBe(false);
});

test('download fetches the engine then the model, verifies both and reports them installed', async () => {
  const { fetchImpl, seen } = fakeFetch();
  const { sd, dir } = make({ fetchImpl });
  expect(sd.status()).toMatchObject({ supported: true, engine: false, models: [{ id: 'tiny', installed: false, recommended: true }] });
  expect(sd.download('tiny')).toBe(true);
  expect(sd.download('tiny')).toBe(false);
  await wait(() => !sd.status().downloading);
  expect(seen[0]).toContain('engine.zip');
  expect(seen[1]).toBe('https://huggingface.co/a/b/resolve/main/tiny.safetensors');
  expect(sd.status()).toMatchObject({ engine: true, error: null, models: [{ installed: true }] });
  expect(readFileSync(join(dir, 'models', 'tiny.safetensors'), 'utf8')).toBe(modelBody);
  rmSync(dir, { recursive: true, force: true });
});

test('a download whose hash does not match is discarded', async () => {
  const { fetchImpl } = fakeFetch({ model: 'tampered' });
  const { sd, dir } = make({ fetchImpl });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  expect(sd.status().error).toContain('corrupted');
  expect(sd.status().models[0].installed).toBe(false);
  expect(readdirSync(join(dir, 'models'))).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test('remove deletes the model and the engine with the last model', async () => {
  const { fetchImpl } = fakeFetch();
  const { sd, dir } = make({ fetchImpl });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  expect(sd.remove('missing')).toBe(false);
  expect(sd.remove('tiny')).toBe(true);
  expect(sd.status()).toMatchObject({ engine: false, models: [{ installed: false }] });
  rmSync(dir, { recursive: true, force: true });
});

async function installed() {
  const { fetchImpl } = fakeFetch();
  const made = make({ fetchImpl });
  made.sd.download('tiny');
  await wait(() => !made.sd.status().downloading);
  return made;
}

function fakeProcess(onSpawn) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => proc.emit('exit', null);
    calls.push({ command, args, options });
    queueMicrotask(() => onSpawn(proc, args));
    return proc;
  };
  return { spawnProcess, calls };
}

test('generate runs the engine with preset arguments only and returns a data URL', async () => {
  const { fetchImpl } = fakeFetch();
  const { spawnProcess, calls } = fakeProcess((proc, args) => {
    writeFileSync(args[args.indexOf('-o') + 1], 'png-bytes');
    proc.stderr.emit('data', '|==>   | 2/4 - 0.50s/it');
    proc.emit('exit', 0);
  });
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  const progress = [];
  const result = await sd.generate(runId, { model: 'tiny', prompt: '--rm -rf', aspectRatio: '16:9' }, (event) => progress.push(event));
  expect(result.image).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
  expect(result.settings).toEqual({ seed: expect.any(Number), steps: 4, cfg: 1 });
  expect(progress).toEqual([{ step: 2, total: 4 }]);
  const { args, command, options } = calls[0];
  expect(command).toEndWith('sd-cli.exe');
  expect(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2)).toEqual(['-p', '--rm -rf']);
  expect(args.slice(args.indexOf('-W'), args.indexOf('-W') + 4)).toEqual(['-W', '512', '-H', '288']);
  expect(options.env.LOMRA_SECRET).toBeUndefined();
  expect(args[args.indexOf('-s') + 1]).toBe(String(result.settings.seed));
  expect(args).toContain('--vae-tiling');
  for (const flag of ['-n', '-i', '--mask', '--strength']) expect(args).not.toContain(flag);
  expect(existsSync(join(dir, 'out', runId))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('generate rejects bad input and missing models without starting the engine', async () => {
  const { spawnProcess, calls } = fakeProcess((proc) => proc.emit('exit', 0));
  const { sd, dir } = make({ spawnProcess });
  await expect(sd.generate(runId, { model: 'tiny', prompt: 'a cat' })).rejects.toThrow('Download this model');
  await expect(sd.generate('nope', { model: 'tiny', prompt: 'a cat' })).rejects.toThrow('Invalid image run');
  expect(calls).toHaveLength(0);
  rmSync(dir, { recursive: true, force: true });
});

test('a failing engine reports its error and cancel stops a running image', async () => {
  const { fetchImpl } = fakeFetch();
  let hold = false;
  const { spawnProcess } = fakeProcess((proc) => { if (hold) return; proc.stderr.emit('data', 'ErrorOutOfDeviceMemory'); proc.emit('exit', 1); });
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  await expect(sd.generate(runId, { model: 'tiny', prompt: 'a cat' })).rejects.toThrow('memory');
  hold = true;
  const running = sd.generate(runId, { model: 'tiny', prompt: 'a cat' });
  const caught = running.catch((cause) => cause.message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  sd.cancel(runId);
  expect(await caught).toBe('Stopped.');
  rmSync(dir, { recursive: true, force: true });
});

const png = (width, height, color = 'x') => {
  const bytes = Buffer.alloc(40, color);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
};

test('a picture and mask become the run’s own files with engine-sized edges, bounded settings and its own progress', async () => {
  const { fetchImpl } = fakeFetch();
  let seen;
  const { spawnProcess, calls } = fakeProcess((proc, args) => {
    const at = (flag) => args[args.indexOf(flag) + 1];
    seen = { image: readFileSync(at('-i')), mask: readFileSync(at('--mask')) };
    writeFileSync(at('-o'), 'png');
    proc.stdout.emit('data', '|=> | 4/4 - 11.0it/s');
    proc.stdout.emit('data', '[I] generating image: 1/1 - seed 7\r|=> | 1/3 - 2.0it/s');
    proc.stdout.emit('data', '|=> | 3/3 - 2.0it/s\n[I] sampling completed, taking 1s\r|=> | 4/4 - 9it/s');
    proc.stdout.emit('data', '|=> | 9/9 - 9it/s');
    proc.emit('exit', 0);
  });
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  const progress = [];
  const image = png(1500, 1000), mask = png(1500, 1000, 'm');
  const result = await sd.generate(runId, { model: 'tiny', prompt: 'a pear', negativePrompt: '--seed 9', seed: 7, steps: 8, cfg: 2.5, strength: 0.5, image, mask, aspectRatio: '1:1' }, (event) => progress.push(event));
  const { args } = calls[0];
  expect(args.slice(args.indexOf('-p'))).toEqual([
    '-p', 'a pear', '-o', join(dir, 'out', runId, 'out.png'), '-W', '576', '-H', '384', '--steps', '8', '--cfg-scale', '2.5', '-s', '7', '-n', '--seed 9',
    '-i', join(dir, 'out', runId, 'init.png'), '--image-preprocess', 'target=init,mode=stretch,filter=bicubic,antialias=true',
    '--mask', join(dir, 'out', runId, 'mask.png'), '--image-preprocess', 'target=mask,mode=stretch', '--strength', '0.5',
  ]);
  expect(`data:image/png;base64,${seen.image.toString('base64')}`).toBe(image);
  expect(`data:image/png;base64,${seen.mask.toString('base64')}`).toBe(mask);
  expect(progress).toEqual([{ step: 1, total: 3 }, { step: 3, total: 3 }]);
  expect(result.settings).toEqual({ seed: 7, steps: 8, cfg: 2.5, negativePrompt: '--seed 9', strength: 0.5, image: true, mask: true });
  expect(existsSync(join(dir, 'out', runId))).toBe(false);
  await sd.generate(runId, { model: 'tiny', prompt: 'a pear', image, mask });
  expect(calls[1].args[calls[1].args.indexOf('--strength') + 1]).toBe('1');
  expect(sdInput({ prompt: 'x', image }, { steps: 20, cfg: 7 }).settings).toMatchObject({ strength: 0.75, cfg: 7 });
  expect(sdInput({ prompt: 'x', image, mask }, { steps: 20, cfg: 7 }).settings).toMatchObject({ strength: 1, cfg: 4 });
  expect(sdInput({ prompt: 'x', image, mask, strength: 0.75 }, { steps: 20, cfg: 7 }).settings).toMatchObject({ strength: 0.75, cfg: 7 });
  const sd15 = { steps: 20, cfg: 7 };
  expect(sdInput({ prompt: 'x', image, mask, strength: 1 }, sd15).settings.cfg).toBe(4);
  expect(sdInput({ prompt: 'x', image, mask, strength: 1, cfg: 9 }, sd15).settings.cfg).toBe(9);
  expect(sdInput({ prompt: 'x', image, strength: 1 }, sd15).settings.cfg).toBe(7);
  rmSync(dir, { recursive: true, force: true });
});

test('bad settings and pictures are refused before the engine starts', async () => {
  const { fetchImpl } = fakeFetch();
  const { spawnProcess, calls } = fakeProcess((proc) => proc.emit('exit', 0));
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  const image = png(64, 64);
  for (const [bad, message] of [
    [{ negativePrompt: 'x'.repeat(2001) }, 'negative prompt'], [{ negativePrompt: 'a\0b' }, 'negative prompt'], [{ negativePrompt: ['-o'] }, 'negative prompt'],
    ...[-1, 1.5, 2147483648, '7', NaN, null].map((seed) => [{ seed }, 'seed']),
    ...[0, 51, 2.5, '4'].map((steps) => [{ steps }, 'steps']),
    ...[-1, 20.5, Infinity, '1'].map((cfg) => [{ cfg }, 'CFG']),
    [{ strength: 0.5 }, 'needs a picture'], [{ mask: image }, 'needs a picture'],
    ...[-0.1, 1.1, '1'].map((strength) => [{ image, strength }, 'strength']),
    [{ image, strength: 0.2 }, 'unchanged'],
    ...['C:/secret.png', 'file:///a.png', 'data:image/gif;base64,YQ==', 'data:image/png;base64,YQ==', png(0, 4), png(9000, 4), `${image}\n`, 5, null].map((value) => [{ image: value }, 'PNG, JPEG or WebP']),
    ...['data:image/jpeg;base64,YQ==', '../mask.png', null].map((mask) => [{ image, mask }, 'mask must be a PNG']),
    [{ image, mask: png(32, 64) }, 'same size'],
    [{ aspectRatio: 1 }, 'aspect ratio'],
  ]) await expect(sd.generate(runId, { model: 'tiny', prompt: 'a cat', ...bad })).rejects.toThrow(message);
  expect(calls).toHaveLength(0);
  expect(existsSync(join(dir, 'out'))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('the run’s pictures are deleted when it is cancelled or fails, and leftovers go with the next run', async () => {
  const { fetchImpl } = fakeFetch();
  let hold = true;
  const { spawnProcess } = fakeProcess((proc) => { if (!hold) proc.emit('exit', 1); });
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  sd.download('tiny');
  await wait(() => !sd.status().downloading);
  const runDir = join(dir, 'out', runId);
  const caught = sd.generate(runId, { model: 'tiny', prompt: 'a cat', image: png(64, 64), mask: png(64, 64) }).catch((cause) => cause.message);
  await wait(() => existsSync(join(runDir, 'mask.png')));
  expect(existsSync(join(runDir, 'init.png'))).toBe(true);
  sd.cancel(runId);
  expect(await caught).toBe('Stopped.');
  expect(existsSync(runDir)).toBe(false);
  hold = false;
  mkdirSync(join(dir, 'out', 'crashed'), { recursive: true });
  await expect(sd.generate(runId, { model: 'tiny', prompt: 'a cat', image: png(64, 64) })).rejects.toThrow('failed');
  expect(readdirSync(join(dir, 'out'))).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test('edits keep the source’s shape within the model’s area on edges the engine does not change', () => {
  expect(editDimensions(1, 512)).toEqual({ width: 512, height: 512 });
  expect(editDimensions(3 / 2, 512)).toEqual({ width: 576, height: 384 });
  expect(editDimensions(16 / 9, 512)).toEqual({ width: 576, height: 320 });
  expect(editDimensions(9 / 16, 512)).toEqual({ width: 320, height: 576 });
  for (const size of [512, 1024]) for (const ratio of [0.01, 0.4, 0.9, 1.2, 2.2, 3.9, 50]) {
    const { width, height } = editDimensions(ratio, size);
    expect([width % 64, height % 64]).toEqual([0, 0]);
    expect(width * height).toBeLessThanOrEqual(size * size);
    expect(Math.abs(Math.log(width / height / Math.min(Math.max(ratio, 0.25), 4)))).toBeLessThan(0.1);
  }
});

test('imageSize reads PNG, JPEG and WebP headers', () => {
  const header = (hex) => Buffer.concat([Buffer.from(hex, 'hex'), Buffer.alloc(40)]);
  expect(imageSize(Buffer.from(png(300, 200).split(',')[1], 'base64'))).toEqual({ width: 300, height: 200 });
  expect(imageSize(header('ffd8ffe000040000ffc0001108012c01f4'))).toEqual({ width: 500, height: 300 });
  expect(imageSize(header('52494646000000005745425056503858' + '0a00000000000000f301002b0100'))).toEqual({ width: 500, height: 300 });
  expect(imageSize(header('52494646000000005745425056503820' + '00000000000000' + '9d012af4012c01'))).toEqual({ width: 500, height: 300 });
  expect(imageSize(header('5249464600000000574542505650384c' + '000000002f' + (499 | (299 << 14)).toString(16).padStart(8, '0').match(/../g).reverse().join('')))).toEqual({ width: 500, height: 300 });
  expect(imageSize(Buffer.from('not a picture at all, really not one'))).toBeNull();
  expect(imageSize(Buffer.alloc(0))).toBeNull();
});

import { customModelId, parseHuggingFace } from './sd-models.mjs';

const tree = [
  { type: 'file', path: 'my.safetensors', size: modelBody.length, lfs: { oid: sha(modelBody) } },
  { type: 'file', path: 'old.ckpt', size: 10, lfs: { oid: sha('x') } },
  { type: 'file', path: 'unet/model.safetensors', size: 10, lfs: { oid: sha('x') } },
  { type: 'file', path: 'README.md', size: 10 },
  { type: 'directory', path: 'vae' },
];

function hubFetch({ status = 200 } = {}) {
  const seen = [];
  const fetchImpl = async (url) => {
    const text = String(url);
    seen.push(text);
    if (text.includes('/api/models/')) return status === 200 ? Response.json(text.includes('/tree/') ? tree : [{ id: 'a/b', downloads: 5 }, { id: '../bad', downloads: 1 }]) : new Response('', { status });
    const siblings = [{ rfilename: 'my.safetensors' }];
    if (text.includes('/api/models?')) return Response.json([
      { id: 'a/b', downloads: 5, gated: false, tags: ['x', 'license:openrail++'], siblings }, { id: 'a/plain', downloads: 4, siblings }, { id: '../bad', downloads: 1, siblings },
      { id: 'a/gated', downloads: 9, gated: 'auto', siblings }, { id: 'a/folders', downloads: 9, siblings: [{ rfilename: 'unet/model.safetensors' }, { rfilename: 'old.ckpt' }] }, { id: 'a/none', downloads: 9 },
      { id: 'a/adult', downloads: 9, tags: ['not-for-all-audiences'], siblings }, { id: 'a/style', downloads: 9, tags: ['lora'], siblings }, { id: 'a/my_controlnet_canny', downloads: 9, siblings },
    ]);
    const body = text.endsWith('engine.zip') ? engineBody : modelBody;
    return new Response(Readable.toWeb(Readable.from([Buffer.from(body)])), { status: 200 });
  };
  return { fetchImpl, seen };
}

test('parseHuggingFace accepts owner/name and huggingface.co links only', () => {
  expect(parseHuggingFace('Lykon/dreamshaper-7')).toEqual({ repo: 'Lykon/dreamshaper-7' });
  expect(parseHuggingFace('https://huggingface.co/Lykon/dreamshaper-7/blob/main/dreamshaper_7.safetensors')).toEqual({ repo: 'Lykon/dreamshaper-7', file: 'dreamshaper_7.safetensors' });
  expect(parseHuggingFace('https://huggingface.co/a/b/resolve/main/w.ckpt')).toEqual({ repo: 'a/b' });
  for (const bad of ['https://evil.com/a/b', 'http://huggingface.co/a/b', '../x/y', 'one', '', 'a/b c']) expect(parseHuggingFace(bad)).toBeNull();
  expect(customModelId('a/b', 'w.safetensors')).toMatch(/^hf-[a-z0-9-]+-[a-f0-9]{6}$/);
  const file = 'weights/half size/w.safetensors';
  expect(customModelId('a'.repeat(96) + '/b', file)).toMatch(/^hf-[a-z0-9]{40}-[a-f0-9]{16}$/);
  expect(parseHuggingFace('https://huggingface.co/a/b/resolve/main/weights/half%20size/w.safetensors')).toEqual({ repo: 'a/b', file });
  expect(sdModelUrl({ repo: 'a/b', file })).toBe('https://huggingface.co/a/b/resolve/main/weights/half%20size/w.safetensors');
  expect(customModelId('a/b', file)).not.toBe(customModelId('a/b', 'weights-half-size-w.safetensors'));
  for (const part of ['a/../b', 'a/%2e%2e/b', 'a//b', 'a%2fb', 'a/.hidden', 'a/text_encoder_2']) {
    expect(parseHuggingFace(`https://huggingface.co/a/b/blob/main/${part}/w.safetensors`)).toBeNull();
  }
});

test('Hugging Face lists nested files across bounded pages and directly looks up pasted files', async () => {
  const file = 'versions/half size/model.safetensors';
  const seen = [];
  const { sd, dir } = make({ fetchImpl: async (url) => {
    seen.push(url);
    if (seen.length === 1) return Response.json(tree, { headers: { link: '<https://huggingface.co/api/models/a/b/tree/main?recursive=true&cursor=next>; rel="next"' } });
    return Response.json([{ type: 'file', path: file, size: 123, lfs: { oid: sha('nested') } }], { headers: { link: '<https://example.com/api/models/a/b/tree/main>; rel="next"' } });
  } });
  try {
    const files = await sd.files('a/b');
    expect(seen).toHaveLength(2);
    expect(files[1]).toEqual({ id: customModelId('a/b', file), file, bytes: 123, sha256: sha('nested') });
    expect(await sd.files('a/b', file)).toEqual([files[1]]);
    expect(seen[2]).toBe('https://huggingface.co/api/models/a/b/tree/main/versions/half%20size');
    await expect(sd.files('a/b', '../secret.safetensors')).rejects.toThrow('not found');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('renamed Hugging Face tree endpoints paginate on the canonical path and reject foreign responses', async () => {
  const first = 'https://huggingface.co/api/models/Example/Old/tree/main?recursive=true';
  const canonical = 'https://huggingface.co/api/models/example/new/tree/main';
  const seen = [];
  const { sd, dir } = make({ fetchImpl: async (url, options) => {
    expect(options.redirect).not.toBe('error');
    seen.push(url);
    const response = Response.json(url === first ? [] : tree, { headers: url === first ? { link: '<?cursor=next>; rel="next"' } : {} });
    Object.defineProperty(response, 'url', { value: url === first ? canonical : url.includes('cursor=next') ? url : 'https://other.example/tree' });
    return response;
  } });
  try {
    expect(await sd.files('Example/Old')).toHaveLength(1);
    expect(seen).toEqual([first, canonical + '?cursor=next']);
    await expect(sd.files('Example/Old', 'my.safetensors')).rejects.toThrow('Could not reach');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a nested download uses the encoded resolver and verifies the exact file listing', async () => {
  const file = 'models/half size/nested.safetensors';
  const seen = [];
  const { sd, dir } = make({ fetchImpl: async (url) => {
    seen.push(url);
    if (url.includes('/tree/')) return Response.json([{ type: 'file', path: file, size: modelBody.length, lfs: { oid: sha(modelBody) } }]);
    return new Response(url.endsWith('engine.zip') ? engineBody : modelBody);
  } });
  try {
    expect(sd.download({ repo: 'a/b', file, family: 'sd15' })).toBe(true);
    await wait(() => !sd.status().downloading);
    expect(seen.slice(1)).toEqual(['https://huggingface.co/api/models/a/b/tree/main/models/half%20size', 'https://huggingface.co/a/b/resolve/main/models/half%20size/nested.safetensors']);
    expect(sd.status().models.find((model) => model.id === customModelId('a/b', file))?.installed).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function localFixture(context = 768) {
  const header = Buffer.from(JSON.stringify({
    'model.diffusion_model.input_blocks.0.0.weight': { shape: [320, 4] },
    'model.diffusion_model.input_blocks.1.1.transformer_blocks.0.attn2.to_k.weight': { shape: [320, context] },
    'first_stage_model.decoder.weight': { shape: [1] },
    'cond_stage_model.encoder.weight': { shape: [1] },
  }));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header]);
}

test('local add and locate use opaque tokens, recheck changed checkpoints, and only forget records on removal', async () => {
  const { fetchImpl, seen } = fakeFetch();
  const { spawnProcess, calls } = fakeProcess((proc, args) => { writeFileSync(args[args.indexOf('-o') + 1], 'png'); proc.emit('exit', 0); });
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  const first = join(dir, 'Thai space ไทย.safetensors');
  const moved = join(dir, 'moved.safetensors');
  try {
    writeFileSync(first, localFixture());
    const { files: [candidate] } = await sd.pickLocal(first, false);
    expect(candidate).toMatchObject({ name: 'Thai space ไทย.safetensors', family: 'sd15', label: 'SD 1.5' });
    expect(JSON.stringify(candidate)).not.toContain(dir);
    expect(sd.canLocate(first)).toBe(false);
    await expect(sd.addLocal(first, 'sd15', true)).rejects.toThrow('Choose a checkpoint');
    await expect(sd.addLocal(candidate.id, 'sd15', { path: first })).rejects.toThrow('Choose a checkpoint');
    expect(await sd.addLocal(candidate.id, 'sd15', false)).toBe(true);
    expect(seen).toHaveLength(0);
    expect(sd.download(candidate.id)).toBe(true);
    await wait(() => !sd.status().downloading);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEndWith('engine.zip');
    expect(sd.status().models.find((model) => model.local)).toMatchObject({ id: candidate.id, installed: true });
    expect(JSON.stringify(sd.status())).not.toContain(dir);
    const { files: [duplicate] } = await sd.pickLocal(first, false);
    await expect(sd.addLocal(duplicate.id, 'sd15', false)).rejects.toThrow('already in Lomra');
    await sd.generate(runId, { model: candidate.id, prompt: 'test' });
    expect(calls[0].args[calls[0].args.indexOf('-m') + 1]).toBe(first);
    renameSync(first, moved);
    await sd.probe();
    expect(sd.status().models.find((model) => model.local)?.localState).toBe('missing');
    renameSync(moved, first);
    await sd.probe();
    expect(sd.status().models.find((model) => model.local)?.installed).toBe(true);
    writeFileSync(first, localFixture(2048));
    await expect(sd.generate(runId, { model: candidate.id, prompt: 'test' })).rejects.toThrow('missing or changed');
    expect(calls).toHaveLength(1);
    expect(await sd.setProfile(candidate.id, 'sdxl')).toBe(true);
    renameSync(first, moved);
    const { files: [replacement] } = await sd.pickLocal(moved, false, candidate.id);
    expect(await sd.addLocal(replacement.id, 'sdxl', false)).toBe(true);
    expect(sd.remove(candidate.id)).toBe(true);
    expect(sd.status().engine).toBe(false);
    expect(readFileSync(moved)).toEqual(localFixture(2048));
    expect(sd.status().models.some((model) => model.local)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a matching local built-in uses the existing id without downloading its weights', async () => {
  const assets = tempDir();
  const file = join(assets, 'renamed.safetensors');
  writeFileSync(file, localFixture());
  const bytes = localFixture().length;
  const sample = await checkpointSample(file, bytes);
  const { sd, dir } = make({ models: [{ ...models[0], bytes, sample }], fetchImpl: fakeFetch().fetchImpl });
  try {
    const { files: [candidate] } = await sd.pickLocal(file, false);
    await sd.addLocal(candidate.id, 'sd15', false);
    expect(sd.status().models).toEqual([expect.objectContaining({ id: 'tiny', local: true })]);
    expect(sd.download({ repo: 'a/b', file: 'tiny.safetensors', family: 'sd15' })).toBe(false);
    expect(sd.remove('tiny')).toBe(true);
    expect(sd.status().models).toEqual([expect.objectContaining({ id: 'tiny', installed: false })]);
    expect(existsSync(file)).toBe(true);
  } finally {
    rmSync(assets, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple checkpoints from one scan can be added, including a fine-tune between the former sample ranges', async () => {
  const { sd, dir } = make();
  const folder = join(dir, 'ComfyUI', 'models', 'checkpoints');
  mkdirSync(folder, { recursive: true });
  const bytes = Buffer.concat([localFixture(), Buffer.alloc(8 * 1024 * 1024)]);
  try {
    writeFileSync(join(folder, 'base.safetensors'), bytes);
    const range = Math.floor(16 * (bytes.length - 65536) / 63);
    bytes[range] = 1;
    writeFileSync(join(folder, 'fine-tune.safetensors'), bytes);
    const scan = await sd.pickLocal(dir, true);
    expect(scan.limited).toBe(false);
    expect(scan.files.map((item) => item.name).sort()).toEqual(['base.safetensors', 'fine-tune.safetensors']);
    for (const file of scan.files) expect(await sd.addLocal(file.id, 'sd15', false)).toBe(true);
    expect(sd.status().models.filter((model) => model.local)).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('files lists top-level checkpoints with Hugging Face’s hashes and explains failures', async () => {
  const { sd } = make({ fetchImpl: hubFetch().fetchImpl });
  expect(await sd.files('a/b')).toEqual([{ id: customModelId('a/b', 'my.safetensors'), file: 'my.safetensors', bytes: modelBody.length, sha256: sha(modelBody) }]);
  await expect(sd.files('nope')).rejects.toThrow('owner/name');
  await expect(make({ fetchImpl: hubFetch({ status: 404 }).fetchImpl }).sd.files('a/b')).rejects.toThrow('not found');
  await expect(make({ fetchImpl: hubFetch({ status: 401 }).fetchImpl }).sd.files('a/b')).rejects.toThrow('login');
});

test('a Hugging Face file that is a built-in model is that model, and one that is installed is not fetched again', async () => {
  const builtIn = [{ ...models[0], file: 'my.safetensors' }];
  const { fetchImpl, seen } = hubFetch();
  const { sd, dir } = make({ fetchImpl, models: builtIn });
  expect((await sd.files('a/b'))[0].id).toBe('tiny');
  expect(sd.download({ repo: 'a/b', file: 'my.safetensors', family: 'sdxl' })).toBe(true);
  await wait(() => !sd.status().downloading);
  expect(sd.status().models).toEqual([expect.objectContaining({ id: 'tiny', custom: false, installed: true })]);
  const asked = seen.length;
  expect(sd.download({ repo: 'a/b', file: 'my.safetensors', family: 'sdxl' })).toBe(true);
  await wait(() => !sd.status().downloading);
  expect(seen).toHaveLength(asked);
  rmSync(dir, { recursive: true, force: true });
});

test('search returns valid repositories with a usable file, without a login, only', async () => {
  const { sd } = make({ fetchImpl: hubFetch().fetchImpl });
  expect(await sd.search('dream')).toEqual({ models: [{ id: 'a/b', downloads: 5, license: 'openrail++' }, { id: 'a/plain', downloads: 4 }] });
  expect(await sd.search('a/adult')).toEqual({ repo: 'a/adult', models: [] });
  expect(await sd.search('https://huggingface.co/a/b/blob/main/my.safetensors')).toEqual({ repo: 'a/b', file: 'my.safetensors', models: [] });
  await expect(sd.search('  ')).rejects.toThrow();
});

test('a Hugging Face checkpoint downloads, verifies, runs with its family settings and can be removed', async () => {
  const { fetchImpl, seen } = hubFetch();
  const { spawnProcess, calls } = fakeProcess((proc, args) => { writeFileSync(args[args.indexOf('-o') + 1], 'png'); proc.emit('exit', 0); });
  const { sd, dir } = make({ fetchImpl, spawnProcess });
  expect(sd.download({ repo: 'a/b', file: 'my.safetensors', family: 'nope' })).toBe(false);
  expect(sd.download({ repo: '../x', file: 'my.safetensors', family: 'sdxl' })).toBe(false);
  expect(sd.download({ repo: 'a/b', file: 'old.ckpt', family: 'sdxl' })).toBe(false);
  expect(sd.download({ repo: 'a/b', file: 'my.safetensors', family: 'sdxl' })).toBe(true);
  await wait(() => !sd.status().downloading);
  expect(sd.status().error).toBeNull();
  expect(seen).toContain('https://huggingface.co/a/b/resolve/main/my.safetensors');
  const custom = sd.status().models.find((model) => model.custom);
  expect(custom).toMatchObject({ name: 'my', installed: true, quality: 'SDXL', note: 'a/b' });
  await sd.generate(runId, { model: custom.id, prompt: 'a cat' });
  const { args } = calls[0];
  expect(args.slice(args.indexOf('-W'), args.indexOf('-W') + 4)).toEqual(['-W', '1024', '-H', '1024']);
  expect(args[args.indexOf('--steps') + 1]).toBe('25');
  expect(args.slice(args.indexOf('--max-vram'), args.indexOf('--max-vram') + 3)).toEqual(['--max-vram', '-3', '--mmap']);
  expect(sd.remove(custom.id)).toBe(true);
  expect(sd.status().models.some((model) => model.custom)).toBe(false);
  expect(sd.status().engine).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('a Hugging Face file whose hash differs from its listing is discarded', async () => {
  const fetchImpl = async (url) => String(url).includes('/api/models/')
    ? Response.json([{ type: 'file', path: 'my.safetensors', size: 8, lfs: { oid: sha('different') } }])
    : String(url).endsWith('engine.zip') ? new Response(engineBody) : new Response(modelBody);
  const { sd, dir } = make({ fetchImpl });
  sd.download({ repo: 'a/b', file: 'my.safetensors', family: 'sd15' });
  await wait(() => !sd.status().downloading);
  expect(sd.status().error).toContain('corrupted');
  expect(sd.status().models.some((model) => model.custom)).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});
