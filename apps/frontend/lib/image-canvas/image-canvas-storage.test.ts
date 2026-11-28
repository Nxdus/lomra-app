import assert from "node:assert/strict";
import test from "node:test";
import { localCanvasStorage as canvasStorage, canvasFileError, canvasFileKind, canvasFileSize, displaySize, imageFileError } from "./image-canvas-storage";
import { canvasHistory, canvasName, canvasStorage as remoteCanvasStorage, isCanvasFilePending, loadCanvasFile, renameCanvas, uniqueNames } from './image-canvas-storage';
import { storageFile, storage } from '../storage';

test("canvas accepts videos and GLB, checks size limits and rejects invalid GLB headers", async () => {
  for (const [name, type, kind] of [["movie.mp4", "video/mp4", "video"], ["movie.webm", "", "video"], ["mesh.glb", "application/octet-stream", "3d"]]) {
    const file = new File(["data"], name, { type });
    assert.equal(canvasFileKind(file), kind);
    assert.equal(canvasFileError(file), null);
  }
  assert.match(canvasFileError(new File(["data"], "mesh.obj"))!, /GLB/);
  assert.match(canvasFileError({ name: "large.mp4", type: "video/mp4", size: 100 * 1024 * 1024 + 1 } as File)!, /100 MB/);
  for (const size of [50 * 1024 * 1024 + 1, 100 * 1024 * 1024]) {
    assert.equal(canvasFileError({ name: "large.glb", type: "model/gltf-binary", size } as File), null);
  }
  assert.match(canvasFileError({ name: "large.glb", type: "model/gltf-binary", size: 100 * 1024 * 1024 + 1 } as File)!, /100 MB/);
  await assert.rejects(canvasFileSize(new File(["invalid"], "mesh.glb"), "blob:test"), /Invalid GLB/);
  const header = new Uint32Array([0x46546c67, 2, 12]);
  assert.deepEqual(await canvasFileSize(new File([header], "mesh.glb"), "blob:test"), { width: 320, height: 320 });
});

test('concurrent file readers share a download and release it after completion or failure', async () => {
  const originalFetch = globalThis.fetch;
  let downloads = 0;
  let fail = false;
  try {
    globalThis.fetch = (async () => {
      downloads++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fail ? new Response(null, { status: 403 }) : new Response('bytes');
    }) as typeof fetch;
    const [a, b] = await Promise.all([storageFile('shared'), storageFile('shared')]);
    assert.equal(downloads, 1);
    assert.equal(await a!.text(), 'bytes');
    assert.equal(await b!.text(), 'bytes');
    await storageFile('shared');
    assert.equal(downloads, 2);
    fail = true;
    await assert.rejects(storageFile('shared'), /403/);
    fail = false;
    assert.equal(await (await storageFile('shared'))!.text(), 'bytes');
    assert.equal(downloads, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test('remote canvas restores file bytes and saves layout without uploading unchanged files', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { path: string; method: string; body?: BodyInit | null }[] = [];
  const item = { id: 'file-1', name: 'original.png', type: 'image/png', lastModified: 123, x: 10, y: 20, width: 100, height: 100 };
  try {
    globalThis.fetch = (async (url, options) => {
      const path = String(url);
      calls.push({ path, method: options?.method ?? 'GET', body: options?.body });
      if (path === '/api/storage/canvas') return Response.json([{ id: 'default', value: [item] }]);
      if (path === '/api/storage/files/file-1') return new Response('original-bytes');
      return Response.json({ saved: true });
    }) as typeof fetch;
    const restored = await remoteCanvasStorage();
    assert.equal(await restored[0].file.text(), 'original-bytes');
    assert.equal(restored[0].file.name, item.name);
    assert.equal(restored[0].file.lastModified, item.lastModified);
    const next = [...restored.map((image) => ({ ...image, x: 55 })), { ...restored[0], id: 'file-2', file: new File(['new-bytes'], 'new.png', { type: 'image/png' }) }];
    await remoteCanvasStorage(next);
    assert.equal(calls.filter((call) => call.path.includes('/files/') && call.method === 'PUT').length, 1);
    const write = calls.find((call) => call.path === '/api/storage/canvas/default');
    assert.ok(write);
    const manifest = JSON.parse(write.body as string).value;
    assert.equal(manifest[0].x, 55);
    assert.equal(manifest[1].name, 'new.png');
    assert.ok(calls.findIndex((call) => call.path === '/api/storage/files/file-2') < calls.indexOf(write));
  } finally { globalThis.fetch = originalFetch; }
});

test('canvas layout opens without file downloads and saves safely while media loads or fails', async () => {
  const originalFetch = globalThis.fetch;
  const items = ['lazy-a', 'lazy-b'].map(id => ({ id, name: `${id}.png`, type: 'image/png', lastModified: 123, x: 10, y: 20, width: 100, height: 80 }));
  let downloads = 0;
  let fail = true;
  let saved: unknown;
  try {
    globalThis.fetch = (async (url, options) => {
      const path = String(url);
      if (path === '/api/storage/canvas') return Response.json([{ id: 'lazy', value: items }]);
      if (path.startsWith('/api/storage/files/')) {
        assert.notEqual(options?.method, 'PUT', 'must not upload placeholder bytes');
        downloads++;
        return fail ? new Response(null, { status: 404 }) : new Response('real-bytes');
      }
      saved = JSON.parse(options!.body as string).value;
      return Response.json({ saved: true });
    }) as typeof fetch;
    const layout = await remoteCanvasStorage(undefined, 'lazy', true);
    assert.equal(downloads, 0);
    assert.ok(layout.every(image => isCanvasFilePending(image.file)));
    assert.deepEqual(layout.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), items.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })));
    await assert.rejects(loadCanvasFile(layout[0]), /404/);
    await remoteCanvasStorage(layout, 'lazy');
    assert.deepEqual(saved, items);
    fail = false;
    const file = await loadCanvasFile(layout[0]);
    assert.equal(await file.text(), 'real-bytes');
    assert.equal(file.name, items[0].name);
    assert.equal(file.lastModified, 123);
    assert.equal(isCanvasFilePending(file), false);
    await remoteCanvasStorage([{ ...layout[0], file, x: 55 }, layout[1]], 'lazy');
    assert.deepEqual(saved, [{ ...items[0], x: 55 }, items[1]]);
  } finally { globalThis.fetch = originalFetch; }
});

test('file downloads recover from transient responses and interrupted bodies without retrying rejected access or uploads', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts === 1) return new Response(null, { status: 503 });
      if (attempts === 2) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Connection terminated')); } }));
      return new Response('complete-file');
    }) as typeof fetch;
    assert.equal(await (await storageFile('interrupted-file'))?.text(), 'complete-file');
    assert.equal(attempts, 3);

    attempts = 0;
    globalThis.fetch = (async () => { attempts++; return new Response(null, { status: 404 }); }) as typeof fetch;
    await assert.rejects(storageFile('missing-file'), /HTTP 404/);
    assert.equal(attempts, 1);

    attempts = 0;
    globalThis.fetch = (async () => { attempts++; throw new TypeError('Network offline'); }) as typeof fetch;
    await assert.rejects(storageFile('upload', new File(['data'], 'test.png')), /Network offline/);
    assert.equal(attempts, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('metadata reads recover from disconnected bodies and never retry unauthorized reads or writes', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts === 1) return new Response(new ReadableStream({ start(c) { c.error(new TypeError('Connection reset')); } }));
      if (attempts === 2) return new Response(null, { status: 502 });
      return Response.json([{ id: 'saved-chat' }]);
    }) as typeof fetch;
    assert.deepEqual(await storage('chats'), [{ id: 'saved-chat' }]);
    assert.equal(attempts, 3);
    attempts = 0;
    globalThis.fetch = (async () => { attempts++; return new Response(null, { status: 401 }); }) as typeof fetch;
    await assert.rejects(storage('chats'), /401/);
    assert.equal(attempts, 1);
    attempts = 0;
    globalThis.fetch = (async () => { attempts++; throw new TypeError('Offline'); }) as typeof fetch;
    await assert.rejects(storage('chats/test', 'PUT', {}), /Offline/);
    assert.equal(attempts, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("image imports accept supported types up to 20 MB and preserve aspect ratio", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
    assert.equal(imageFileError(new File(["image"], "image", { type })), null);
  }
  for (const type of ["image/svg+xml", "text/plain", ""]) {
    assert.match(imageFileError(new File(["data"], "file", { type }))!, /PNG/);
  }
  assert.equal(imageFileError(new File([new Uint8Array(20 * 1024 * 1024)], "limit.png", { type: "image/png" })), null);
  assert.match(imageFileError(new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }))!, /20 MB/);
  assert.deepEqual(displaySize(1600, 800), { width: 320, height: 160 });
  assert.deepEqual(displaySize(100, 200), { width: 100, height: 200 });
  assert.deepEqual(displaySize(800, 1600), { width: 160, height: 320 });
});

test("storage waits for transaction completion and rejects aborted saves", async () => {
  const original = globalThis.indexedDB;
  let closed = 0;
  let mode = "";
  let written: unknown;
  let abort = false;
  const stored = [{ id: "existing" }];
  const db = {
    close() { closed++; },
    transaction(_store: string, transactionMode: string) {
      mode = transactionMode;
      const transaction = {
        error: new Error("Quota exceeded"),
        oncomplete: () => {}, onabort: () => {}, onerror: () => {},
        objectStore() {
          return {
            get: () => ({ result: stored }),
            put(value: unknown) { written = value; return {}; },
          };
        },
      };
      setTimeout(() => abort ? transaction.onabort() : transaction.oncomplete(), 0);
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open() {
      const request = { result: db, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  } });
  try {
    assert.deepEqual(await canvasStorage(), stored);
    assert.equal(mode, "readonly");
    assert.deepEqual(await canvasStorage([]), []);
    assert.equal(mode, "readwrite");
    assert.deepEqual(written, []);
    abort = true;
    await assert.rejects(canvasStorage([]), /Quota exceeded/);
    assert.equal(closed, 3);
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: original });
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});


test('separate canvases preserve the original and reopen saved file layouts', async () => {
  const originalFetch = globalThis.fetch;
  const id = 'canvas-1794300000000-12345678-1234-1234-1234-123456789abc';
  const rows = new Map<string, unknown[]>([['default', []]]);
  try {
    globalThis.fetch = (async (url, options) => {
      const path = String(url);
      if (path === '/api/storage/canvas' && !options?.method) return Response.json([...rows].map(([id, value]) => ({ id, value })));
      if (path === '/api/storage/settings') return Response.json([]);
      if (path.startsWith('/api/storage/canvas/') && options?.method === 'PUT') {
        rows.set(decodeURIComponent(path.split('/').at(-1)!), JSON.parse(options.body as string).value);
        return Response.json({ saved: true });
      }
      if (path.includes('/files/')) return options?.method === 'PUT' ? Response.json({ saved: true }) : new Response('history-bytes');
      throw new Error(`Unexpected request: ${path}`);
    }) as typeof fetch;
    await remoteCanvasStorage([], id);
    const file = new File(['history-bytes'], 'history.png', { type: 'image/png' });
    await remoteCanvasStorage([{ id: 'history-file', file, x: 42, y: 20, width: 100, height: 80 }], id);
    assert.deepEqual(await remoteCanvasStorage(), []);
    const restored = await remoteCanvasStorage(undefined, id);
    assert.equal(restored[0].x, 42);
    assert.equal(await restored[0].file.text(), 'history-bytes');
    const history = await canvasHistory();
    assert.deepEqual(history, [{ id, count: 1, date: Number(id.split('-')[1]) }, { id: 'default', count: 0 }]);
    assert.deepEqual([canvasName(id, history), canvasName('default', history)], ['Canvas 1', 'Original canvas']);
    await assert.rejects(remoteCanvasStorage(undefined, 'missing'), /no longer exists/);
  } finally { globalThis.fetch = originalFetch; }
});

test('repeated item names get numbers when a canvas loads, without touching the stored files', async () => {
  assert.deepEqual(uniqueNames(['Image 1.png', 'Image 1.png', 'Image 2.png', 'Image 1.png', 'clip.mp4', 'clip.mp4', 'notes']),
    ['Image 1.png', 'Image 3.png', 'Image 2.png', 'Image 4.png', 'clip.mp4', 'clip 2.mp4', 'notes']);
  const originalFetch = globalThis.fetch;
  const saved = ['a', 'b'].map((id) => ({ id, x: 0, y: 0, width: 10, height: 10, name: 'Image 1.png', type: 'image/png', lastModified: 1 }));
  const fetched: string[] = [];
  try {
    globalThis.fetch = (async (url, options) => {
      const path = String(url);
      if (path === '/api/storage/canvas' && !options?.method) return Response.json([{ id: 'default', value: saved }]);
      if (path.includes('/files/') && options?.method !== 'PUT') { fetched.push(path); return new Response('bytes'); }
      throw new Error(`Unexpected request: ${path}`);
    }) as typeof fetch;
    assert.deepEqual((await remoteCanvasStorage()).map(({ id, file }) => [id, file.name]), [['a', 'Image 1.png'], ['b', 'Image 2.png']]);
    assert.deepEqual((await remoteCanvasStorage(undefined, 'default', true)).map(({ file }) => file.name), ['Image 1.png', 'Image 2.png']);
    assert.equal(fetched.length, 2);
    assert.equal(saved[1].name, 'Image 1.png');
  } finally { globalThis.fetch = originalFetch; }
});

test('canvas names are trimmed, persist separately from file manifests and reject blank names', async () => {
  const originalFetch = globalThis.fetch;
  const settings = new Map<string, unknown>();
  const manifest = [{ id: 'model', name: 'source.glb' }];
  try {
    globalThis.fetch = (async (url, options) => {
      const path = String(url);
      if (path === '/api/storage/settings') return Response.json([...settings].map(([id, value]) => ({ id, value })));
      if (path === '/api/storage/canvas') return Response.json([{ id: 'default', value: manifest }]);
      assert.equal(path, '/api/storage/settings/canvas-name-default');
      assert.equal(options?.method, 'PUT');
      settings.set('canvas-name-default', JSON.parse(options!.body as string).value);
      return Response.json({ saved: true });
    }) as typeof fetch;
    assert.equal(await renameCanvas('default', '  Models  '), 'Models');
    assert.deepEqual(await canvasHistory(), [{ id: 'default', count: 1, name: 'Models' }]);
    await assert.rejects(renameCanvas('default', '  '), /cannot be empty/);
    assert.deepEqual(await canvasHistory(), [{ id: 'default', count: 1, name: 'Models' }]);
    assert.deepEqual(manifest, [{ id: 'model', name: 'source.glb' }]);
  } finally { globalThis.fetch = originalFetch; }
});
