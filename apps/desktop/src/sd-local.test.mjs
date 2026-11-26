import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newLocalModelId, readLocalCheckpoint, scanCheckpoints, validLocalPick, validLocalRecord } from './sd-local.mjs';

test('local records validate ids, absolute checkpoint paths, and file metadata', () => {
  const record = { id: newLocalModelId(), path: join(tmpdir(), 'model.gguf'), family: 'sd15', bytes: 123, mtimeMs: 900 };
  expect(validLocalRecord(record)).toBe(true);
  for (const change of [{ id: '../escape' }, { path: 'relative.gguf' }, { path: join(tmpdir(), 'model.ckpt') }, { bytes: -1 }, { bytes: 0.5 }, { mtimeMs: Infinity }, { family: [] }]) {
    expect(validLocalRecord({ ...record, ...change })).toBe(false);
  }
  expect(validLocalPick('file')).toBe(true);
  expect(validLocalPick('folder')).toBe(true);
  expect(validLocalPick('file', record.path)).toBe(false);
  expect(validLocalPick(record.path)).toBe(false);
  expect(validLocalPick('locate', record.path)).toBe(false);
  expect(validLocalPick('locate', { path: record.path })).toBe(false);
});

test('folder scan finds conventional layouts, bounds traversal, and skips escaping links and pickle', async () => {
  // realpath: Windows runners give tmpdir() as an 8.3 short path, but scan results are canonical.
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'sd-scan-')));
  const picked = join(scratch, 'app');
  const outside = join(scratch, 'outside');
  const conventional = join(picked, 'models', 'checkpoints');
  const forge = join(picked, 'models', 'Stable-diffusion');
  const deep = join(conventional, 'nested');
  try {
    for (const dir of [outside, deep, forge]) mkdirSync(dir, { recursive: true });
    const direct = join(conventional, 'direct.safetensors');
    const directForge = join(forge, 'forge.gguf');
    const nested = join(deep, 'nested.GGUF');
    for (const file of [direct, nested, directForge, join(picked, 'ignored.safetensors'), join(conventional, 'pickle.ckpt'), join(outside, 'escape.gguf')]) writeFileSync(file, '');
    symlinkSync(outside, join(conventional, 'escape'), 'junction');
    const files = (await scanCheckpoints(picked)).files;
    expect(new Set(files)).toEqual(new Set([direct, directForge, nested]));
    expect(new Set((await scanCheckpoints(picked, { maxDepth: 0 })).files)).toEqual(new Set([direct, directForge]));
    expect((await scanCheckpoints(picked, { maxDepth: 0 })).limited).toBe(true);
    expect(await scanCheckpoints(picked, { maxEntries: 0 })).toMatchObject({ files: [], limited: true });
    const capped = await scanCheckpoints(picked, { maxFiles: 1 });
    expect(capped.files).toHaveLength(1);
    expect(capped.limited).toBe(true);
    await expect(readLocalCheckpoint(join(conventional, 'escape', 'escape.gguf'), picked)).rejects.toThrow('find the checkpoint');
    await expect(readLocalCheckpoint(direct)).rejects.toThrow('whole Stable Diffusion');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
