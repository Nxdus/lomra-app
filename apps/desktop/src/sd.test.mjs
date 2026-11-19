import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { engineError, createSd } from './sd.mjs';
import { sdDimensions, sdEngines, sdModels } from './sd-models.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const tempDir = () => mkdtempSync(join(tmpdir(), 'lomra-sd-'));
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
  expect(engineError('ggml_vulkan: ErrorOutOfDeviceMemory')).toContain('memory');
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
  expect(existsSync(join(dir, 'models', 'tiny.safetensors.part'))).toBe(false);
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
  expect(result).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
  expect(progress).toEqual([{ step: 2, total: 4 }]);
  const { args, command, options } = calls[0];
  expect(command).toEndWith('sd-cli.exe');
  expect(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2)).toEqual(['-p', '--rm -rf']);
  expect(args.slice(args.indexOf('-W'), args.indexOf('-W') + 4)).toEqual(['-W', '512', '-H', '288']);
  expect(options.env.LOMRA_SECRET).toBeUndefined();
  expect(existsSync(join(dir, 'out', `${runId}.png`))).toBe(false);
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
    if (text.includes('/api/models?')) return Response.json([{ id: 'a/b', downloads: 5 }, { id: '../bad', downloads: 1 }]);
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
});

test('files lists top-level checkpoints with Hugging Face’s hashes and explains failures', async () => {
  const { sd } = make({ fetchImpl: hubFetch().fetchImpl });
  expect(await sd.files('a/b')).toEqual([{ file: 'my.safetensors', bytes: modelBody.length, sha256: sha(modelBody) }]);
  await expect(sd.files('nope')).rejects.toThrow('owner/name');
  await expect(make({ fetchImpl: hubFetch({ status: 404 }).fetchImpl }).sd.files('a/b')).rejects.toThrow('not found');
  await expect(make({ fetchImpl: hubFetch({ status: 401 }).fetchImpl }).sd.files('a/b')).rejects.toThrow('login');
});

test('search returns valid repositories only', async () => {
  const { sd } = make({ fetchImpl: hubFetch().fetchImpl });
  expect(await sd.search('dream')).toEqual({ models: [{ id: 'a/b', downloads: 5 }] });
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
