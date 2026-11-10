import assert from "node:assert/strict";
import test from "node:test";
import { chatStorage, persistentUrl, restoreGenerations, type Chat } from "./chat-storage";
import type { Generation } from "./generation";

test("restores unfinished jobs for explicit recovery without changing completed results", () => {
  const task: Generation = { id: "job", category: "video", model: "video/model", prompt: "cat", status: "Queued", requestId: "existing-job" };
  const complete = { ...task, status: "Completed" };
  const [restored, done, unsubmitted] = restoreGenerations([task, complete, { ...task, requestId: undefined }]);
  assert.equal(restored.requestId, "existing-job");
  assert.equal(restored.status, "Interrupted");
  assert.match(restored.error!, /Check job/);
  assert.equal(done, complete);
  assert.match(unsubmitted.error!, /try again/);
  assert.equal(task.status, "Queued");
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
      if (String(url) === '/api/storage') return Response.json({ account: null });
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
