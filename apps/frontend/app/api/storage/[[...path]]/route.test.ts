// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { test, expect } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LOMRA_DATA_DIR = await mkdtemp(join(tmpdir(), 'lomra-route-'));
const { GET, PUT, DELETE, POST } = await import('./route');

const origin = 'http://localhost:3000';
const call = (handler: typeof GET, path: string[], init: RequestInit = {}) =>
  handler(new Request(`${origin}/api/storage/${path.join('/')}`, { ...init, headers: { origin, host: new URL(origin).host, ...init.headers } }), { params: Promise.resolve({ path }) });

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

test('removed catalog models and an empty selection are saved', async () => {
  const settings = [
    { id: 'hidden-models', value: ['llm:google/gemini-3.1-flash-lite'] },
    { id: 'selected-models', value: [] },
    { id: 'disabled-agents', value: ['opencode'] },
    { id: 'speech-model', value: 'base' },
    { id: 'agent-limits', value: { claude: { updatedAt: 1795020000000, windows: [{ id: 'five_hour', label: '5 hr', usedPercent: 35, resetsAt: 1795026600 }] } } },
  ];
  for (const { id, value } of settings) {
    expect((await call(PUT, ['settings', id], { method: 'PUT', body: JSON.stringify({ value }) })).status).toBe(200);
  }
  expect(await (await call(GET, ['settings'])).json()).toEqual([...settings].sort((a, b) => a.id.localeCompare(b.id)));
});

test('project export and import endpoints handle portable archives', async () => {
  const canvasItem = {
    id: 'route-asset',
    name: 'asset.png',
    type: 'image/png',
    lastModified: 1700000000000,
    x: 10,
    y: 20,
    width: 100,
    height: 100,
  };
  expect((await call(PUT, ['files', 'route-asset'], { method: 'PUT', body: new Uint8Array([42, 43, 44]) })).status).toBe(200);
  expect((await call(PUT, ['canvas', 'default'], { method: 'PUT', body: JSON.stringify({ value: [canvasItem] }) })).status).toBe(200);
  expect((await call(PUT, ['settings', 'canvas-name-default'], { method: 'PUT', body: JSON.stringify({ value: 'Exported Route Project' }) })).status).toBe(200);

  // Export default canvas
  const exportRes = await call(GET, ['export', 'default']);
  expect(exportRes.status).toBe(200);
  expect(exportRes.headers.get('content-type')).toBe('application/octet-stream');
  expect(exportRes.headers.get('content-disposition')).toContain('Exported Route Project');
  const archiveBytes = new Uint8Array(await exportRes.arrayBuffer());
  expect(archiveBytes.byteLength).toBeGreaterThan(0);

  // Import project
  const importRes = await call(POST, ['import'], { method: 'POST', body: archiveBytes });
  expect(importRes.status).toBe(200);
  const importedData = await importRes.json();
  expect(importedData.name).toBe('Exported Route Project');
  expect(importedData.itemCount).toBe(1);
  expect(importedData.canvasId).toMatch(/^canvas-\d{13}-[a-f0-9-]{36}$/);

  // Bad import
  const badImport = await call(POST, ['import'], { method: 'POST', body: new Uint8Array(0) });
  expect(badImport.status).toBe(400);
});
