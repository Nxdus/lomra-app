import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSd } from './sd.mjs';
import { customModelId, sdFamilies } from './sd-models.mjs';
import { classify, namedFewStep, readCheckpoint, UnreadableHeader } from './sd-header.mjs';

const checkpoint = ({ channels = 4, context = 768, level = 1, text = 'cond_stage_model.x', vae = 'first_stage_model.x' } = {}) => ({
  'model.diffusion_model.input_blocks.0.0.weight': [320, channels, 3, 3],
  [`model.diffusion_model.input_blocks.${level}.1.transformer_blocks.0.attn2.to_k.weight`]: [320, context],
  ...(text && { [text]: [1] }), ...(vae && { [vae]: [1] }),
});
const sdxl = (extra = {}) => checkpoint({ context: 2048, level: 4, text: 'conditioner.embedders.0.x', ...extra });

function safetensors(tensors, weights = 64) {
  const json = Buffer.from(JSON.stringify({ __metadata__: { format: 'pt' }, ...Object.fromEntries(Object.entries(tensors).map(([name, shape]) => [name, { dtype: 'F16', shape, data_offsets: [0, 0] }])) }));
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([size, json, Buffer.alloc(weights)]);
}

function gguf(tensors, { padding = 0 } = {}) {
  const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
  const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
  const text = (value) => Buffer.concat([u64(Buffer.byteLength(value)), Buffer.from(value)]);
  const entries = Object.entries(tensors);
  const meta = [
    Buffer.concat([text('general.architecture'), u32(8), text('sd')]),
    Buffer.concat([text('flag'), u32(7), Buffer.from([1])]),
    Buffer.concat([text('list'), u32(9), u32(8), u64(2), text('a'), text('b'.repeat(padding))]),
    Buffer.concat([text('numbers'), u32(9), u32(4), u64(3), Buffer.alloc(12)]),
  ];
  return Buffer.concat([
    Buffer.from('GGUF'), u32(3), u64(entries.length), u64(meta.length), ...meta,
    ...entries.map(([name, shape]) => Buffer.concat([text(name), u32(shape.length), ...[...shape].reverse().map(u64), u32(1), u64(0)])),
    Buffer.alloc(64),
  ]);
}

const reader = (bytes) => async (start, length) => bytes.subarray(start, start + length);
const read = (ext, bytes) => readCheckpoint(ext, reader(bytes));
const map = (tensors) => classify(new Map(Object.entries(tensors)));

test('classify tells the checkpoints the engine is given settings for', () => {
  expect(map(checkpoint())).toEqual({ supported: true, family: 'sd15', label: 'SD 1.5', inpaint: false });
  expect(map(checkpoint({ channels: 9 }))).toEqual({ supported: true, family: 'sd15', label: 'SD 1.5', inpaint: true });
  expect(map(checkpoint({ context: 1024 }))).toEqual({ supported: true, family: 'sd15', label: 'SD 2', inpaint: false });
  expect(map(sdxl())).toEqual({ supported: true, family: 'sdxl', label: 'SDXL', inpaint: false });
  expect(map(sdxl({ channels: 9 })).inpaint).toBe(true);
});

test('classify refuses what is not a whole Stable Diffusion checkpoint', () => {
  for (const tensors of [
    {}, { 'context_refiner.0.x': [1] }, { 'lora_unet_x.lora_down.weight': [4, 320] }, { 'control_model.input_blocks.0.0.weight': [320, 4, 3, 3] },
    checkpoint({ text: '' }), checkpoint({ vae: '' }), checkpoint({ channels: 8 }), checkpoint({ context: 1280, level: 4 }),
  ]) expect(map(tensors)).toEqual({ supported: false });
});

test('both file formats are read', async () => {
  expect(await read('.safetensors', safetensors(sdxl()))).toMatchObject({ label: 'SDXL' });
  expect(await read('.gguf', gguf(checkpoint({ channels: 9 })))).toMatchObject({ label: 'SD 1.5', inpaint: true });
  // A header longer than the first read is asked for again.
  expect(await read('.gguf', gguf(checkpoint(), { padding: 300_000 }))).toMatchObject({ label: 'SD 1.5', inpaint: false });
});

test('a damaged or unexpected header is unreadable rather than unsupported', async () => {
  const good = gguf(checkpoint());
  const oldVersion = Buffer.from(good);
  oldVersion.writeUInt32LE(1, 4);
  const huge = Buffer.from(good);
  huge.writeBigUInt64LE(1n << 60n, 8);
  for (const [ext, bytes] of [
    ['.gguf', Buffer.alloc(0)], ['.gguf', Buffer.from('nope')], ['.gguf', good.subarray(0, 60)], ['.gguf', oldVersion], ['.gguf', huge],
    ['.safetensors', Buffer.from('{"not":"length-prefixed"}')], ['.safetensors', safetensors(checkpoint()).subarray(0, 40)],
  ]) await expect(read(ext, bytes)).rejects.toThrow(UnreadableHeader);
});

test('few-step models are recognised by name only', () => {
  for (const name of ['sd_xl_turbo', 'a/Lightning-4step', 'x_LCM', 'Hyper-SD15']) expect(namedFewStep(name)).toBe(true);
  expect(namedFewStep('dreamshaper_8')).toBe(false);
});

function hub(t) {
  const asked = [];
  const server = createServer((request, response) => {
    asked.push(request.headers.range);
    const name = request.url.split('/').pop();
    if (name.startsWith('gated')) { response.statusCode = 401; response.end(); return; }
    const body = t[name];
    if (!body) { response.statusCode = 404; response.end(); return; }
    if (name.startsWith('whole')) { response.end(body); return; }
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(request.headers.range).map(Number);
    const part = body.subarray(start, end + 1);
    response.writeHead(206, { 'content-range': `bytes ${start}-${start + part.length - 1}/${body.length}` });
    response.end(part);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const fetchImpl = (url, init) => fetch(String(url).replace('https://huggingface.co', `http://127.0.0.1:${port}`), init);
    resolve({ fetchImpl, asked, close: () => server.close() });
  }));
}

test('inspect reads only the header of a remote file and says what to download it as', async () => {
  const { fetchImpl, asked, close } = await hub({
    'plain.safetensors': safetensors(checkpoint(), 5_000_000), 'fill.gguf': gguf(checkpoint({ channels: 9 })), 'model-lightning.safetensors': safetensors(sdxl()),
    'sd_xl_turbo_1.0.safetensors': safetensors(sdxl()), 'z_image.gguf': gguf({ 'context_refiner.0.x': [1] }), 'whole.safetensors': safetensors(checkpoint()),
  });
  const dir = mkdtempSync(join(tmpdir(), 'lomra-sd-header-'));
  const sd = createSd({ dir, platform: 'win32', arch: 'x64', fetchImpl });
  expect(await sd.inspect('a/b', 'plain.safetensors')).toEqual({ known: true, supported: true, label: 'SD 1.5', inpaint: false, family: 'sd15', fewStepFamily: 'turbo', fewStep: false });
  expect(asked.every((range) => Number(range.split('-')[1]) < 10_000)).toBe(true);
  expect(await sd.inspect('a/b', 'fill.gguf')).toMatchObject({ inpaint: true, family: 'sd15' });
  expect(await sd.inspect('a/b', 'model-lightning.safetensors')).toMatchObject({ label: 'SDXL', fewStep: true, fewStepFamily: 'sdxl-few' });
  expect(await sd.inspect('a/b', 'sd_xl_turbo_1.0.safetensors')).toMatchObject({ fewStepFamily: 'turbo' });
  expect(await sd.inspect('a/b', 'z_image.gguf')).toEqual({ known: true, supported: false });
  // A server that ignores the range would send the whole file; it is not read.
  expect(await sd.inspect('a/b', 'whole.safetensors')).toEqual({ known: false });
  expect(await sd.inspect('a/b', 'missing.safetensors')).toEqual({ known: false });
  await expect(sd.inspect('a/b', 'gated.safetensors')).rejects.toThrow('login');
  for (const [repo, file] of [['../x', 'a.gguf'], ['a/b', '../a.gguf'], ['a/b', 'a.ckpt'], [1, 'a.gguf'], ['a/b', null]]) await expect(sd.inspect(repo, file)).rejects.toThrow('not found');
  for (const id of ['sd15', 'sdxl', 'turbo', 'sdxl-few']) expect(sdFamilies.some((family) => family.id === id)).toBe(true);
  close();
  rmSync(dir, { recursive: true, force: true });
});

test('probe finds installed inpainting models and the graphics memory, and never fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-sd-header-'));
  const sd = createSd({ dir, platform: 'win32', arch: 'x64', gpuMemory: async () => 8e9 });
  await sd.probe();
  const custom = join(dir, 'custom');
  const add = (file, bytes) => {
    const id = customModelId('a/b', file);
    writeFileSync(join(custom, `${id}${file.slice(file.lastIndexOf('.'))}`), bytes);
    writeFileSync(join(custom, `${id}.json`), JSON.stringify({ id, repo: 'a/b', file, family: 'sd15', bytes: 1, sha256: 'a'.repeat(64) }));
  };
  mkdirSync(custom, { recursive: true });
  add('fill.gguf', gguf(checkpoint({ channels: 9 })));
  add('plain.safetensors', safetensors(checkpoint()));
  add('broken.safetensors', Buffer.from('x'));
  await sd.probe();
  expect(sd.status().gpuBytes).toBe(8e9);
  expect(Object.fromEntries(sd.status().models.filter((model) => model.custom).map((model) => [model.name, model.inpaint]))).toEqual({ fill: true, plain: false, broken: false });
  expect(sd.remove(customModelId('a/b', 'fill.gguf'))).toBe(true);
  rmSync(dir, { recursive: true, force: true });
  const failing = createSd({ dir, platform: 'win32', arch: 'x64', gpuMemory: async () => { throw new Error('no nvidia-smi'); } });
  await failing.probe();
  expect(failing.status().gpuBytes).toBe(0);
});
