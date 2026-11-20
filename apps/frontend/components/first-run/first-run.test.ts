import assert from "node:assert/strict";
import test from "node:test";
import {
  checkIsFirstRun,
  dismissFirstRun,
  dismissSampleBanner,
  isSampleBannerDismissed,
  FIRST_RUN_STORAGE_KEY,
  SAMPLE_BANNER_STORAGE_KEY,
} from "./use-first-run";
import { createSampleFiles, loadSampleProject } from "./sample-project";
import type { CanvasHandle } from "@/components/image-canvas";

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

test("checkIsFirstRun returns true for a clean, brand new workspace", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();

  try {
    Object.assign(globalThis, {
      window: {},
      localStorage: mockStorage,
    });

    globalThis.fetch = (async (url: string) => {
      if (url.includes("/api/storage/canvas")) return Response.json([]);
      if (url.includes("/api/storage/chats")) return Response.json([]);
      if (url.includes("/api/storage/keys")) return Response.json([]);
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkIsFirstRun();
    assert.equal(result, true);
    assert.equal(mockStorage.getItem(FIRST_RUN_STORAGE_KEY), null);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("checkIsFirstRun returns false if first-run has already been dismissed", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();
  mockStorage.setItem(FIRST_RUN_STORAGE_KEY, "true");

  try {
    Object.assign(globalThis, {
      window: {},
      localStorage: mockStorage,
    });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkIsFirstRun();
    assert.equal(result, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("checkIsFirstRun detects existing workspace with canvas items and does not disturb it", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();

  try {
    Object.assign(globalThis, {
      window: {},
      localStorage: mockStorage,
    });

    globalThis.fetch = (async (url: string) => {
      if (url.includes("/api/storage/canvas")) {
        return Response.json([
          { id: "default", value: [{ id: "item-1", name: "drawing.png", type: "image/png", x: 0, y: 0, width: 200, height: 200, lastModified: 1000 }] },
        ]);
      }
      if (url.includes("/api/storage/chats")) return Response.json([]);
      if (url.includes("/api/storage/keys")) return Response.json([]);
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkIsFirstRun();
    assert.equal(result, false);
    // Marks as dismissed so subsequent checks don't need to re-query
    assert.equal(mockStorage.getItem(FIRST_RUN_STORAGE_KEY), "true");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("checkIsFirstRun detects existing workspace with chats or keys and bypasses flow", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();

  try {
    Object.assign(globalThis, {
      window: {},
      localStorage: mockStorage,
    });

    globalThis.fetch = (async (url: string) => {
      if (url.includes("/api/storage/canvas")) return Response.json([]);
      if (url.includes("/api/storage/chats")) return Response.json([{ id: "chat-1", value: {} }]);
      if (url.includes("/api/storage/keys")) return Response.json([]);
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkIsFirstRun();
    assert.equal(result, false);
    assert.equal(mockStorage.getItem(FIRST_RUN_STORAGE_KEY), "true");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("checkIsFirstRun fails safe (returns false) if storage errors", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();

  try {
    Object.assign(globalThis, {
      window: {},
      localStorage: mockStorage,
    });

    globalThis.fetch = (async () => {
      throw new Error("Storage server unreachable");
    }) as typeof fetch;

    const result = await checkIsFirstRun();
    assert.equal(result, false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("dismissFirstRun and dismissSampleBanner persist flags in localStorage", () => {
  const originalWindow = globalThis.window;
  const mockStorage = createMockStorage();

  try {
    Object.assign(globalThis, {
      window: {},
      localStorage: mockStorage,
    });

    assert.equal(mockStorage.getItem(FIRST_RUN_STORAGE_KEY), null);
    dismissFirstRun();
    assert.equal(mockStorage.getItem(FIRST_RUN_STORAGE_KEY), "true");

    assert.equal(isSampleBannerDismissed(), false);
    dismissSampleBanner();
    assert.equal(isSampleBannerDismissed(), true);
    assert.equal(mockStorage.getItem(SAMPLE_BANNER_STORAGE_KEY), "true");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("createSampleFiles generates valid sample PNG files without network/keys", async () => {
  const files = await createSampleFiles();
  assert.equal(files.length, 3);

  const [character, scene, moodboard] = files;
  assert.equal(character.name, "demo-character-concept.png");
  assert.equal(character.type, "image/png");
  assert.ok(character.size > 0);

  assert.equal(scene.name, "demo-scene-keyframe.png");
  assert.equal(scene.type, "image/png");
  assert.ok(scene.size > 0);

  assert.equal(moodboard.name, "demo-style-moodboard.png");
  assert.equal(moodboard.type, "image/png");
  assert.ok(moodboard.size > 0);
});

test("loadSampleProject throws when canvas is null", async () => {
  await assert.rejects(loadSampleProject(null), /Canvas is not ready/);
});

test("loadSampleProject adds files and focuses item on canvas", async () => {
  const addedCalls: { files: File[]; at?: { x: number; y: number } }[] = [];
  let focusedFile: File | null = null;

  const mockCanvas: CanvasHandle = {
    addFiles: async (files, at) => {
      addedCalls.push({ files, at });
      return files.map((_, index) => `id-${index}-${Date.now()}`);
    },
    removeItems: () => {},
    focusFile: (file) => {
      focusedFile = file;
    },
    modelPreview: () => "",
    deselect: () => {},
  };

  const ids = await loadSampleProject(mockCanvas);
  assert.equal(ids.length, 3);
  assert.equal(addedCalls.length, 3);
  assert.ok(focusedFile !== null);
  assert.equal((focusedFile as File).name, "demo-character-concept.png");
});
