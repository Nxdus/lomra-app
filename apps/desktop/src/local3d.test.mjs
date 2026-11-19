import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { createLocal3d, workerError } from './local3d.mjs';
import { local3dDownloads, local3dModels, local3dUv } from './local3d-models.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const runId = '11111111-1111-1111-1111-111111111111';
const png = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;

const bodies = { 'uv.zip': 'uv-zip', 'source.zip': 'source-zip', 'tripo.zip': 'tripo-zip', 'u2net.onnx': 'u2net', 'big.bin': 'big', 'small.bin': 'small' };
const uv = { 'win32-x64': { asset: 'uv.zip', url: 'https://x/uv.zip', sha256: sha(bodies['uv.zip']), bytes: 6 } };
const source = { url: 'https://x/source.zip', sha256: sha(bodies['source.zip']), bytes: 10 };
const downloads = [{ path: 'u2net/u2net.onnx', url: 'https://x/u2net.onnx', sha256: sha(bodies['u2net.onnx']), bytes: 5 }];
const file = (path, name) => ({ path, url: `https://x/${name}`, sha256: sha(bodies[name]), bytes: bodies[name].length });
const models = [
  { id: 'big', name: 'Big', quality: 'Best', note: '', kind: 'hunyuan', folder: 'tencent/big', repo: 'tencent/big', subfolder: 'dit', needs: 8000, default: true, weights: [file('tencent/big/dit/model.bin', 'big.bin')] },
  { id: 'tiny', name: 'Tiny', quality: 'Fast', note: '', kind: 'triposr', folder: 'tiny', needs: 6000, source: { path: 'sources/tiny', url: 'https://x/tripo.zip', sha256: sha(bodies['tripo.zip']), bytes: 8 }, weights: [file('tiny/config.yaml', 'small.bin')] },
];

const fakeFetch = (override = {}) => async (url) => new Response(Readable.toWeb(Readable.from([Buffer.from(override[basename(String(url))] ?? bodies[basename(String(url))])])), { status: 200 });
const fakeExtract = async (zip, dest) => {
  if (basename(zip) === 'uv.zip') writeFileSync(join(dest, 'uv.exe'), 'uv');
  else { mkdirSync(join(dest, 'Tiny-abc', 'tsr'), { recursive: true }); writeFileSync(join(dest, 'Tiny-abc', 'tsr', '__init__.py'), ''); }
};

/** A process that exits with `code` after `run` (which may write files) and prints `lines` to stdout. */
function fakeProcess(run, code = 0, lines = []) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => proc.emit('exit', null);
  queueMicrotask(() => {
    run?.();
    for (const line of lines) proc.stdout.emit('data', `${line}\n`);
    proc.emit('exit', code);
  });
  return proc;
}

function make(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-3d-'));
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    if (basename(command) === 'uv.exe' && args[0] === 'venv') return fakeProcess(() => { mkdirSync(join(args[3], 'Scripts'), { recursive: true }); writeFileSync(join(args[3], 'Scripts', 'python.exe'), 'py'); });
    if (basename(command) === 'python.exe') return fakeProcess(() => writeFileSync(args[5], 'glb-bytes'), 0, ['{"stage":"loading"}', 'library noise', '{"stage":"shape"}']);
    return fakeProcess();
  };
  const local3d = createLocal3d({ dir, platform: 'win32', arch: 'x64', env: { LOMRA_SECRET: 'x', PATH: '/bin' }, fetchImpl: fakeFetch(), spawnProcess, extract: fakeExtract, gpuMemory: async () => 8192, uv, downloads, source, models, ...overrides });
  return { local3d, dir, calls };
}

async function install(local3d, id) {
  expect(await local3d.install(id)).toBe(true);
  for (let i = 0; i < 400; i++) { const status = await local3d.status(); if (!status.installing) return status; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error('install did not finish');
}
const uvSteps = (calls) => calls.filter((call) => basename(call.command) === 'uv.exe').map((call) => call.args.slice(0, 2).join(' '));

test('pinned downloads carry a SHA-256 and a revision, never a moving branch', () => {
  for (const item of [...local3dDownloads, ...local3dModels.flatMap((model) => [...model.weights, ...(model.source ? [model.source] : [])])]) expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const model of local3dModels) for (const weight of model.weights) expect(weight.url).toMatch(/\/resolve\/[a-f0-9]{40}\//);
  for (const model of local3dModels.filter((item) => item.source)) expect(model.source.url).toMatch(/\/archive\/[a-f0-9]{40}\.zip$/);
  expect(local3dUv['win32-x64'].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(new Set(local3dModels.map((model) => model.id)).size).toBe(local3dModels.length);
});

test('status explains why a computer without a suitable NVIDIA card is unsupported', async () => {
  const none = make({ gpuMemory: async () => 0 }).local3d;
  expect(await none.status()).toMatchObject({ supported: false, engine: false, reason: expect.stringContaining('NVIDIA') });
  expect(await none.install('big')).toBe(false);
  expect(await make({ gpuMemory: async () => 4096 }).local3d.status()).toMatchObject({ supported: false, reason: expect.stringContaining('6 GB') });
  expect(await make({ arch: 'arm64' }).local3d.status()).toMatchObject({ supported: false });
});

test('a card too small for one model can still install a lighter one', async () => {
  const { local3d } = make({ gpuMemory: async () => 6144 });
  const status = await local3d.status();
  expect(status.supported).toBe(true);
  expect(status.models.map((model) => [model.id, model.fits])).toEqual([['big', false], ['tiny', true]]);
  expect(await local3d.install('big')).toBe(false);
  expect(await local3d.install('unknown')).toBe(false);
  expect((await install(local3d, 'tiny')).models.find((model) => model.id === 'tiny').installed).toBe(true);
});

test('install builds the shared environment once, then only adds each model', async () => {
  const { local3d, dir, calls } = make();
  expect((await local3d.status()).models.every((model) => !model.installed)).toBe(true);
  const first = await install(local3d, 'big');
  expect(first).toMatchObject({ engine: true, error: null, installing: null });
  expect(first.models.map((model) => [model.id, model.installed])).toEqual([['big', true], ['tiny', false]]);
  expect(uvSteps(calls)).toEqual(['venv --python', 'pip install', 'pip install', 'pip install']);
  expect(calls.find((call) => call.args.includes('--no-deps')).args).toContain(join(dir, 'hunyuan3d-source.zip'));
  expect(readFileSync(join(dir, 'models/tencent/big/dit/model.bin'), 'utf8')).toBe('big');
  expect(readFileSync(join(dir, 'u2net/u2net.onnx'), 'utf8')).toBe('u2net');
  // The installer never sees app secrets.
  expect(calls.every((call) => !('LOMRA_SECRET' in call.options.env))).toBe(true);
  const before = calls.length;
  const second = await install(local3d, 'tiny');
  expect(second.models.every((model) => model.installed)).toBe(true);
  expect(uvSteps(calls.slice(before))).toEqual([]);
  expect(existsSync(join(dir, 'sources/tiny/tsr/__init__.py'))).toBe(true);
  expect(existsSync(join(dir, 'sources/tiny/.ok'))).toBe(true);
});

test('an install from an older version of the engine is brought up to date without downloading models again', async () => {
  const { local3d, dir, calls } = make();
  await install(local3d, 'big');
  writeFileSync(join(dir, 'packages.json'), JSON.stringify({ version: 1 }));
  expect((await local3d.status()).models[0].installed).toBe(false);
  const before = calls.length;
  expect((await install(local3d, 'big')).models[0].installed).toBe(true);
  expect(uvSteps(calls.slice(before))).toEqual(['pip install', 'pip install', 'pip install']);
});

test('a download that does not match its SHA-256 fails the installation and leaves nothing behind', async () => {
  const { local3d, dir } = make({ fetchImpl: fakeFetch({ 'big.bin': 'tampered' }) });
  const status = await install(local3d, 'big');
  expect(status).toMatchObject({ error: 'The download was corrupted. Try again.' });
  expect(status.models[0].installed).toBe(false);
  expect(existsSync(join(dir, 'models/tencent/big/dit/model.bin'))).toBe(false);
  expect(existsSync(join(dir, 'models/tencent/big/dit/model.bin.part'))).toBe(false);
});

test('generate runs the Hunyuan worker with the model repo and a clean environment, and reports progress', async () => {
  const { local3d, calls, dir } = make();
  await install(local3d, 'big');
  const stages = [];
  const model = await local3d.generate(runId, { model: 'big', image: png }, (event) => stages.push(event.stage));
  expect(model).toBe(`data:model/gltf-binary;base64,${Buffer.from('glb-bytes').toString('base64')}`);
  expect(stages).toEqual(['loading', 'shape']);
  const run = calls.find((call) => basename(call.command) === 'python.exe');
  expect(run.args.slice(3, 4)).toEqual(['hunyuan']);
  expect(run.args.slice(-2)).toEqual(['tencent/big', 'dit']);
  expect(run.options.env).toMatchObject({ HF_HUB_OFFLINE: '1', HY3DGEN_MODELS: join(dir, 'models'), U2NET_HOME: join(dir, 'u2net') });
  expect(run.options.env.LOMRA_SECRET).toBeUndefined();
  expect(run.options.env.PYTHONPATH).toBeUndefined();
  expect(existsSync(join(dir, 'worker', 'torchmcubes.py'))).toBe(true);
  expect(existsSync(join(dir, 'out', `${runId}.glb`))).toBe(false);
  expect(existsSync(join(dir, 'out', `${runId}.png`))).toBe(false);
});

test('generate runs TripoSR from its unpacked source and its own weights folder', async () => {
  const { local3d, calls, dir } = make();
  await install(local3d, 'tiny');
  await local3d.generate(runId, { model: 'tiny', image: png });
  const run = calls.find((call) => basename(call.command) === 'python.exe');
  expect(run.args.slice(3, 4)).toEqual(['triposr']);
  expect(run.args.slice(-2)).toEqual([join(dir, 'models', 'tiny'), join(dir, 'models', 'tiny', 'dino-vitb16-config.json')]);
  expect(run.options.env.PYTHONPATH).toBe(join(dir, 'sources/tiny'));
});

test('generate rejects anything but a picture, a UUID run id and an installed model', async () => {
  const fresh = make();
  await expect(fresh.local3d.generate(runId, { model: 'big', image: png })).rejects.toThrow('Install this 3D model');
  const { local3d } = make();
  await install(local3d, 'big');
  await expect(local3d.generate(runId, { model: 'tiny', image: png })).rejects.toThrow('Install this 3D model');
  await expect(local3d.generate(runId, { model: '../big', image: png })).rejects.toThrow('Install this 3D model');
  await expect(local3d.generate('../x', { model: 'big', image: png })).rejects.toThrow('Invalid 3D run');
  await expect(local3d.generate(runId, { model: 'big', image: 'C:\\secret.png' })).rejects.toThrow('PNG, JPEG or WebP');
  await expect(local3d.generate(runId, { model: 'big', image: 'data:text/html;base64,AAAA' })).rejects.toThrow('PNG, JPEG or WebP');
  await expect(local3d.generate(runId, undefined)).rejects.toThrow('Install this 3D model');
});

test('workerError turns the worker reason into advice', () => {
  expect(workerError('{"stage":"error","reason":"memory"}')).toContain('graphics memory');
  expect(workerError('{"stage":"error","reason":"no-cuda"}')).toContain('driver');
  expect(workerError('garbage')).toBe('The 3D model could not be made.');
  expect(workerError('{"stage":"error","reason":"failed","detail":"No module named x"}')).toBe('The 3D model could not be made: No module named x');
});

test('remove deletes one model and keeps the engine until the last model goes', async () => {
  const { local3d, dir } = make();
  await install(local3d, 'big');
  await install(local3d, 'tiny');
  expect(local3d.remove('big')).toBe(true);
  expect(existsSync(join(dir, 'models/tencent/big'))).toBe(false);
  expect(existsSync(join(dir, 'venv'))).toBe(true);
  expect((await local3d.status()).models.map((model) => model.installed)).toEqual([false, true]);
  expect(local3d.remove('nope')).toBe(false);
  expect(local3d.remove('tiny')).toBe(true);
  expect(existsSync(dir)).toBe(false);
});
