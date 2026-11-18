// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { test, expect } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LOMRA_DATA_DIR = await mkdtemp(join(tmpdir(), 'lomra-route-'));
const { GET, PUT, DELETE } = await import('./route');

const origin = 'http://localhost:3000';
const call = (handler: typeof GET, path: string[], init: RequestInit = {}) =>
  handler(new Request(`${origin}/api/storage/${path.join('/')}`, { ...init, headers: { origin, ...init.headers } }), { params: Promise.resolve({ path }) });

test('files and saved state round-trip through the workspace folder', async () => {
  expect((await call(PUT, ['files', 'asset'], { method: 'PUT', body: new Uint8Array([0, 128, 255]) })).status).toBe(200);
  const file = await call(GET, ['files', 'asset']);
  expect(file.headers.get('content-type')).toBe('application/octet-stream');
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
  expect((await call(GET, ['files', 'missing'])).status).toBe(404);

  const value = { x: 1, y: 2 };
  expect((await call(PUT, ['settings', 'prompt-position'], { method: 'PUT', body: JSON.stringify({ value }) })).status).toBe(200);
  expect(await (await call(GET, ['settings'])).json()).toEqual([{ id: 'prompt-position', value }]);
  expect((await call(DELETE, ['settings', 'prompt-position'], { method: 'DELETE' })).status).toBe(200);
  expect(await (await call(GET, ['settings'])).json()).toEqual([]);
});

test('invalid requests are rejected', async () => {
  expect((await call(GET, [])).status).toBe(404);
  expect((await call(GET, ['unknown'])).status).toBe(404);
  expect((await call(PUT, ['settings', 'prompt-position'], { method: 'PUT', body: '{"value":1}' })).status).toBe(400);
  expect((await call(PUT, ['settings', 'prompt-position'], { method: 'PUT', body: 'nope' })).status).toBe(400);
  expect((await call(PUT, ['files', 'asset'], { method: 'PUT', body: new Uint8Array([1]), headers: { origin: 'http://evil.example' } })).status).toBe(403);
  expect((await call(GET, ['settings'], { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
});
