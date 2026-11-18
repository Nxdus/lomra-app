// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalStore } from './store';

const canvasId = 'canvas-1700000000000-' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12);
const item = (id: string) => ({ id, name: `${id}.png`, type: 'image/png', lastModified: 1, x: 0, y: 0, width: 10, height: 10 });

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'lomra-store-'));
  return { root, store: createLocalStore(root, Buffer.alloc(32, 7)) };
}

test('saved state round-trips as readable JSON files', async () => {
  const { root, store: s } = await store();
  await s.save('canvas', 'default', [item('a')]);
  expect(await s.list('canvas')).toEqual([{ id: 'default', value: [item('a')] }]);
  expect(JSON.parse(await readFile(join(root, 'canvas', 'default.json'), 'utf8'))).toEqual([item('a')]);
  expect(await readdir(join(root, 'canvas'))).toEqual(['default.json']);
});

test('invalid state and unsafe IDs are rejected', async () => {
  const { store: s } = await store();
  await expect(s.save('canvas', 'default', [{ id: 'a' }])).rejects.toMatchObject({ status: 400 });
  await expect(s.save('settings', '../camera', { x: 0, y: 0, scale: 1 })).rejects.toMatchObject({ status: 400 });
  await expect(s.readFile('../secret')).rejects.toMatchObject({ status: 400 });
  await expect(s.readFile('missing')).rejects.toMatchObject({ status: 404 });
});

test('API keys are encrypted on disk and decrypted when listed', async () => {
  const { root, store: s } = await store();
  await s.save('keys', 'fal', ' secret-key ');
  expect(await readFile(join(root, 'keys', 'fal.json'), 'utf8')).not.toContain('secret-key');
  expect(await s.list('keys')).toEqual([{ id: 'fal', value: 'secret-key' }]);
  await expect(s.save('keys', 'other', 'x')).rejects.toMatchObject({ status: 400 });
});

test('files are immutable and size limited', async () => {
  const { store: s } = await store();
  await s.writeFile('f1', new Uint8Array([1, 2]));
  await s.writeFile('f1', new Uint8Array([9]));
  expect([...await s.readFile('f1')]).toEqual([1, 2]);
  await expect(s.writeFile('f2', new Uint8Array(0))).rejects.toMatchObject({ status: 400 });
});

test('deleting a canvas removes its chats, settings and unshared files only', async () => {
  const { store: s } = await store();
  await s.save('canvas', 'default', [item('shared'), item('own')]);
  await s.save('canvas', canvasId, [item('shared')]);
  for (const id of ['shared', 'own']) await s.writeFile(id, new Uint8Array([1]));
  await s.save('settings', 'camera', { x: 0, y: 0, scale: 1 });
  await s.save('settings', 'canvas-name-default', 'Main');
  await s.save('chats', 'c1', { id: 'c1', title: 't', updatedAt: 1, history: [], generations: [], models: [] });
  await s.remove('canvas', 'default');
  expect((await s.list('canvas')).map((row) => row.id)).toEqual([canvasId]);
  expect(await s.list('chats')).toEqual([]);
  expect(await s.list('settings')).toEqual([]);
  expect([...await s.readFile('shared')]).toEqual([1]);
  await expect(s.readFile('own')).rejects.toMatchObject({ status: 404 });
});
