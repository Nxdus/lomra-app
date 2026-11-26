import assert from "node:assert/strict";
import test from "node:test";
import { chatStorage, persistentUrl, restoreGenerations, writeChat, type Chat } from "./chat-storage";
import type { Generation } from "./generation";

test("restores unfinished jobs for explicit recovery without changing completed results", () => {
  const task: Generation = { id: "job", category: "video", model: "video/model", prompt: "cat", status: "Queued", requestId: "existing-job" };
  const complete = { ...task, status: "Completed" };
  const stopped = { ...task, status: "Stopped" };
  const [restored, done, unsubmitted, restoredStop] = restoreGenerations([task, complete, { ...task, requestId: undefined }, stopped]);
  assert.equal(restored.requestId, "existing-job");
  assert.equal(restored.status, "Interrupted");
  assert.match(restored.error!, /Check job/);
  assert.equal(done, complete);
  assert.equal(restoredStop, stopped);
  assert.equal(restoredStop.requestId, "existing-job");
  assert.equal(restoredStop.error, undefined);
  assert.match(unsubmitted.error!, /try again/);
  assert.equal(task.status, "Queued");
});

test("an acknowledged chat write returns the saved chat without refreshing the list", async () => {
  const previousFetch = globalThis.fetch;
  const chat: Chat = { id: "story-owner", title: "Storyboard", updatedAt: 1, history: [], generations: [], models: [] };
  try {
    globalThis.fetch = (async (url, options) => {
      assert.match(String(url), /\/chats\/story-owner$/);
      assert.equal(options?.method, "PUT");
      assert.deepEqual(JSON.parse(options?.body as string).value, chat);
      return Response.json({ saved: true });
    }) as typeof fetch;
    assert.deepEqual(await writeChat(chat), chat);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("remote and inline result URLs remain unchanged", async () => {
  assert.equal(await persistentUrl("https://media.example/result.mp4"), "https://media.example/result.mp4");
  assert.equal(await persistentUrl("data:image/png;base64,YQ=="), "data:image/png;base64,YQ==");
});


test("chat history is isolated by canvas and legacy chats belong to the original canvas", async () => {
  const previousFetch = globalThis.fetch;
  const previousLocalStorage = globalThis.localStorage;
  const canvasId = 'canvas-1794300000000-12345678-1234-1234-1234-123456789abc';
  const legacy: Chat = { id: 'old', title: 'Original chat', updatedAt: 1, history: [], generations: [], models: [] };
  const scoped: Chat = { ...legacy, id: 'new', canvasId, title: 'New canvas chat', updatedAt: 2 };
  const rows = [legacy, scoped];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'true' } });
  try {
    globalThis.fetch = (async (url, options) => {
      if (options?.method === 'PUT') {
        const chat = JSON.parse(options.body as string).value as Chat;
        rows.push(chat);
        return Response.json({ saved: true });
      }
      return Response.json(rows.map((value) => ({ id: value.id, value })));
    }) as typeof fetch;
    assert.deepEqual(await chatStorage(), [legacy]);
    assert.deepEqual(await chatStorage(undefined, canvasId), [scoped]);
    assert.deepEqual(await chatStorage(undefined, 'empty-canvas'), []);
    const saved = { ...scoped, id: 'another', updatedAt: 3 };
    assert.deepEqual(await chatStorage(saved, canvasId), [saved, scoped]);
    assert.deepEqual(await chatStorage(), [legacy]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage });
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test("inline GLB results upload as binary once, leaving only a small durable link in chat", async () => {
  const previousFetch = globalThis.fetch;
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'true' } });
  const file = { kind: "file" as const, name: "GLB", url: "data:model/gltf-binary;base64,Z2xURg==" };
  const chat: Chat = { id: 'binary-chat', title: 'test', updatedAt: 1, history: [], models: [], generations: [{ id: 'g', category: '3d', model: 'Local media tools', status: 'Completed', prompt: 'optimize', files: [file] }] };
  let uploaded = 0, saved: Chat | undefined, failUpload = true;
  try {
    globalThis.fetch = (async (url, options) => {
      const path = String(url);
      if (path.startsWith('data:')) return previousFetch(url, options);
      if (path.startsWith('/api/storage/files/') && options?.method === 'PUT') {
        uploaded++;
        assert.ok(options.body instanceof File);
        assert.equal(options.body.size, 4);
        return Response.json({}, { status: failUpload ? 500 : 200 });
      }
      if (options?.method === 'PUT') {
        saved = JSON.parse(options.body as string).value;
        assert.ok((options.body as string).length < 1000);
        return Response.json({ saved: true });
      }
      return Response.json(saved ? [{ value: saved }] : []);
    }) as typeof fetch;
    await assert.rejects(chatStorage(chat), /Could not access canvas file/);
    assert.equal(saved, undefined);
    failUpload = false;
    await chatStorage(chat);
    assert.match(saved!.generations[0].files![0].url, /^\/api\/storage\/files\/[\w-]+$/);
    assert.equal(file.url, 'data:model/gltf-binary;base64,Z2xURg==');
    await chatStorage(chat);
    assert.equal(uploaded, 2, 'failed upload retries; successful uploads are reused');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage });
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
