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

test('Character metadata and its own reference survive deleting the source canvas', async () => {
  const { store: s } = await store();
  const id = 'character-00000000-0000-0000-0000-000000000001';
  const value = { id, name: 'น้องฝน', notes: 'Yellow coat', imageType: 'image/png' };
  await s.save('canvas', 'default', [item('source')]);
  await s.writeFile('source', new Uint8Array([1]));
  await s.writeFile(id, await s.readFile('source'));
  await s.save('characters', id, value);
  await expect(s.save('characters', id, { ...value, name: 'name with spaces' })).rejects.toMatchObject({ status: 400 });
  await s.remove('canvas', 'default');
  expect(await s.list('characters')).toEqual([{ id, value }]);
  expect([...await s.readFile(id)]).toEqual([1]);
});

test('chat history preserves attached image previews alongside older text messages', async () => {
  const { store: s } = await store();
  const history = [
    { role: 'user', content: 'Earlier message' },
    { role: 'user', content: 'See this image', images: [{ name: 'canvas.jpg', url: 'data:image/jpeg;base64,/9j/' }] },
  ];
  const chat = { id: 'chat', title: 'Chat', updatedAt: 1, history, generations: [], models: [] };
  await s.save('chats', chat.id, chat);
  expect(await s.list('chats')).toEqual([{ id: chat.id, value: chat }]);
  history[1].images![0].url = 'blob:ephemeral';
  await expect(s.save('chats', chat.id, chat)).rejects.toMatchObject({ status: 400 });
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
