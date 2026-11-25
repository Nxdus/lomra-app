import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createPictureAi, pictureAiInput, workerError } from './picture-ai.mjs';
import { pictureAiModels } from './picture-ai-models.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const runId = '11111111-1111-1111-1111-111111111111';
const runId2 = '22222222-2222-2222-2222-222222222222';

function makePng(width, height) {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const smallPng = makePng(256, 256);

const bodies = {
  'bg.onnx': 'birefnet-bytes',
  'up.onnx': 'realesrgan-bytes',
};
const testModels = [
  { id: 'bg', operation: 'remove-background', name: 'BG', quality: 'BG', note: '', license: 'MIT license', source: 'https://example.com/bg', url: 'https://x/bg.onnx', sha256: sha(bodies['bg.onnx']), bytes: bodies['bg.onnx'].length },
  { id: 'up', operation: 'upscale', name: 'UP', quality: 'UP', note: '', license: 'BSD-3-Clause license', source: 'https://example.com/up', url: 'https://x/up.onnx', sha256: sha(bodies['up.onnx']), bytes: bodies['up.onnx'].length },
];

const fakeFetch = (override = {}) => async (url) => {
  const key = String(url).split('/').pop();
  return new Response(Readable.toWeb(Readable.from([Buffer.from(override[key] ?? bodies[key])])), { status: 200 });
};

function fakeProcess(run, code = 0, lines = [], stayOpen = false) {
  const proc = new EventEmitter();
  proc.pid = 1234;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => { proc.emit('exit', null); proc.emit('close'); };
  if (!stayOpen) {
    queueMicrotask(() => {
      run?.();
      for (const line of lines) proc.stdout.emit('data', `${line}\n`);
      proc.emit('exit', code);
      proc.emit('close');
    });
  }
  return proc;
}

function make(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-pic-'));
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    if (overrides.hang) return fakeProcess(undefined, 0, [], true);
    return fakeProcess(() => writeFileSync(args[4], 'out-png-bytes'), 0, ['{"stage":"loading"}', '{"stage":"processing","done":1,"total":1}']);
  };
  const ai = createPictureAi({
    dir,
    env: { LOMRA_SECRET: 'secret', PATH: '/bin' },
    fetchImpl: fakeFetch(),
    spawnProcess,
    execPath: '/node',
    workerPath: '/worker.mjs',
    models: testModels,
    ...overrides,
  });
  return { ai, dir, calls };
}

async function downloadAndWait(ai, id) {
  expect(ai.download(id)).toBe(true);
  for (let i = 0; i < 200; i++) {
    const status = ai.status();
    if (!status.downloading && !status.queued.length) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('download did not finish');
}

test('pinned picture models carry SHA-256, commit revision, byte size, and commercial-allowed license', () => {
  expect(pictureAiModels.length).toBe(2);
  for (const model of pictureAiModels) {
    expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.url).toMatch(/\/resolve\/[a-f0-9]{40}\//);
    expect(model.bytes).toBeGreaterThan(0);
    expect(model.source).toMatch(/^https:\/\//);
    expect(model.license).toMatch(/MIT|BSD-3-Clause|Apache/i);
  }
});

test('pictureAiInput validates operations, scales, image types, and output size bounds', () => {
  expect(pictureAiInput({ operation: 'remove-background', image: smallPng }, testModels).model.id).toBe('bg');
  expect(pictureAiInput({ operation: 'upscale', scale: 2, image: smallPng }, testModels).scale).toBe(2);
  expect(pictureAiInput({ operation: 'upscale', scale: 4, image: makePng(1920, 1080) }, testModels).scale).toBe(4);
  expect(() => pictureAiInput({ operation: 'upscale', scale: 3, image: smallPng }, testModels)).toThrow('Scale must be 2 or 4');
  expect(() => pictureAiInput({ operation: 'remove-background', scale: 2, image: smallPng }, testModels)).toThrow('Scale applies only');
  expect(() => pictureAiInput({ operation: 'other', image: smallPng }, testModels)).toThrow('Unknown picture operation');
  expect(() => pictureAiInput({ operation: 'upscale', scale: 4, image: 'C:\\secret.png' }, testModels)).toThrow('PNG, JPEG or WebP');
  // 2500 x 2500 at 4x = 10000 x 10000 > 8192 px
  expect(() => pictureAiInput({ operation: 'upscale', scale: 4, image: makePng(2500, 2500) }, testModels)).toThrow('8192 px');
  // 2048 x 2048 at 4x = 8192 x 8192 = 67M px > 36M px
  expect(() => pictureAiInput({ operation: 'upscale', scale: 4, image: makePng(2048, 2048) }, testModels)).toThrow('36 megapixel');
});

test('download verifies SHA-256, discards corrupted bytes, and remove deletes the model', async () => {
  const { ai, dir } = make({ fetchImpl: fakeFetch({ 'bg.onnx': 'bad' }) });
  const bad = await downloadAndWait(ai, 'bg');
  expect(bad.error).toContain('corrupted');
  expect(existsSync(join(dir, 'models/bg.onnx'))).toBe(false);
  expect(readdirSync(join(dir, 'models'))).toEqual([]);

  const ok = make();
  const status = await downloadAndWait(ok.ai, 'bg');
  expect(status.error).toBeNull();
  expect(status.models.find((m) => m.id === 'bg').installed).toBe(true);
  expect(readFileSync(join(ok.dir, 'models/bg.onnx'), 'utf8')).toBe('birefnet-bytes');
  expect(ok.ai.remove('bg')).toBe(true);
  expect(existsSync(join(ok.dir, 'models/bg.onnx'))).toBe(false);
  expect(ok.ai.remove('missing')).toBe(false);
});

test('run spawns worker with clean environment, reports progress, cleans temp files, and supports cancel', async () => {
  const { ai, dir, calls } = make();
  await expect(ai.run(runId, { operation: 'remove-background', image: smallPng })).rejects.toThrow('Download BG');
  await downloadAndWait(ai, 'bg');
  await downloadAndWait(ai, 'up');

  const events = [];
  const res = await ai.run(runId, { operation: 'upscale', scale: 2, image: smallPng }, (e) => events.push(e));
  expect(res).toEqual({ image: `data:image/png;base64,${Buffer.from('out-png-bytes').toString('base64')}`, model: 'up' });
  expect(events).toEqual([{ stage: 'loading' }, { stage: 'processing', done: 1, total: 1 }]);
  expect(calls[0].args).toEqual(['/worker.mjs', 'upscale', join(dir, 'models/up.onnx'), join(dir, 'out', runId, 'in.png'), join(dir, 'out', runId, 'out.png'), '2']);
  expect(calls[0].options.env.LOMRA_SECRET).toBeUndefined();
  expect(calls[0].options.env.ELECTRON_RUN_AS_NODE).toBe('1');
  expect(existsSync(join(dir, 'out', runId))).toBe(false);

  const hanging = make({ hang: true });
  await downloadAndWait(hanging.ai, 'bg');
  const pending = hanging.ai.run(runId2, { operation: 'remove-background', image: smallPng });
  await new Promise((resolve) => setTimeout(resolve, 10));
  hanging.ai.cancel(runId2);
  await expect(pending).rejects.toThrow('Stopped.');
});

test('workerError parses worker JSON errors and falls back cleanly', () => {
  expect(workerError('{"stage":"error","message":"Scale must be 2 or 4."}')).toBe('Scale must be 2 or 4.');
  expect(workerError('noise')).toBe('Local picture processing failed.');
});
