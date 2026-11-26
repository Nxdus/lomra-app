import assert from "node:assert/strict";
import test from "node:test";
import { canvasResults, generate, modelFiles, requiresImage, safeMediaUrl, selectedModel, isMultiview, multiviewError, type Generation, type ModelViews } from "./generation";

test("Hunyuan maps texture intent to textured_mesh without changing unspecified defaults", async () => {
  const views: ModelViews = Object.fromEntries(["front", "back", "left"].map((view, i) => [view, { url: `data:image/png;base64,${["YQ==", "Yg==", "Yw=="][i]}`, name: view }]));
  for (const texture of [true, false, undefined]) {
    const task: Generation = { id: "texture", category: "3d", model: "fal-ai/hunyuan3d/v2/multi-view", prompt: "hippo", status: "Waiting", views, texture };
    const request = async (_provider: unknown, options: { action: string; input?: unknown }) => {
      if (options.action === "submit") {
        assert.deepEqual(options.input, { front_image_url: views.front!.url, back_image_url: views.back!.url, left_image_url: views.left!.url, ...(texture === undefined ? {} : { textured_mesh: texture }) });
        return { request_id: "job-texture" };
      }
      return options.action === "status" ? { status: "COMPLETED" } : { model_mesh: { url: "https://fal.media/hippo.glb" } };
    };
    await generate(task, request, new AbortController().signal, () => {});
  }
  let calls = 0;
  await assert.rejects(generate({ id: "unsupported", category: "3d", model: "other/model", prompt: "hippo", texture: true, status: "Waiting" }, async () => { calls++; return {}; }, new AbortController().signal, () => {}), /Texture control/);
  assert.equal(calls, 0);
});

test("multiview validates views, sends named inputs, and resumes without submitting again", async () => {
  const views: ModelViews = { front: { url: "data:image/png;base64,YQ==", name: "front.png" }, back: { url: "data:image/png;base64,Yg==", name: "back.png" } };
  const model = "hitem3d/hi3d/v3.0/multi-view-to-3d";
  assert.ok(isMultiview(model));
  assert.ok(isMultiview("fal-ai/hunyuan3d/v2/multi-view"));
  assert.equal(isMultiview("fal-ai/trellis"), false);
  assert.match(multiviewError(model, {})!, /at least 1/);
  assert.equal(multiviewError(model, { back: views.back }), undefined);
  assert.match(multiviewError(model, { front: views.front, back: views.front })!, /different image/);
  assert.match(multiviewError("fal-ai/hunyuan3d/v2/multi-view", views)!, /left/);
  const task: Generation = { id: "multi", category: "3d", model, prompt: "test", views, status: "Waiting" };
  const actions: string[] = [];
  const request = async (_provider: unknown, options: { action: string; input?: unknown }) => {
    actions.push(options.action);
    if (options.action === "submit") {
      assert.deepEqual(options.input, { front_image_url: views.front!.url, back_image_url: views.back!.url });
      return { request_id: "multiview-job" };
    }
    return options.action === "status" ? { status: "COMPLETED" } : { model_mesh: { url: "https://fal.media/model.glb" } };
  };
  const signal = new AbortController().signal;
  await assert.rejects(generate({ ...task, views: {} }, request, signal, () => {}), /at least 1/);
  assert.deepEqual(actions, []);
  await generate(task, request, signal, () => {});
  assert.deepEqual(actions, ["submit", "status", "result"]);
  actions.length = 0;
  await generate({ ...task, requestId: "multiview-job", views: undefined }, request, signal, () => {});
  assert.deepEqual(actions, ["status", "result"]);
});

test("3D canvas imports prefer real GLB, fall back to OBJ, and never import thumbnails or textures", () => {
  const rapid = modelFiles({
    thumbnail: { url: "https://fal.media/preview.png" },
    model_obj: { url: "https://fal.media/model.obj" },
    material_mtl: { url: "https://fal.media/material.mtl" },
    texture: { url: "https://fal.media/texture.png" },
  });
  assert.deepEqual(canvasResults(rapid, "3d").map((file) => file.name), ["OBJ"]);
  const pro = modelFiles({ model_glb: { url: "https://fal.media/model.glb" }, model_urls: { glb: { url: "https://fal.media/model.glb" } } });
  assert.equal(pro.length, 1);
  assert.deepEqual(canvasResults([...rapid, ...pro], "3d"), pro);
  assert.deepEqual(canvasResults(rapid.filter((file) => file.name !== "OBJ"), "3d"), []);
  assert.deepEqual(canvasResults([{ url: "https://fal.media/image.png", name: "Image", kind: "image" }], "picture").map((file) => file.name), ["Image"]);
  assert.deepEqual(modelFiles({ model_glb: { url: "javascript:alert(1)" } }), []);
});

test("tools use selected models, return images and resume queued jobs without resubmission", async () => {
  assert.equal(selectedModel(["llm:vendor/model:free", "picture:selected/image"], "llm"), "vendor/model:free");
  assert.equal(safeMediaUrl("javascript:alert(1)"), false);
  assert.deepEqual(modelFiles({ model_urls: { glb: { url: "https://fal.media/cat.glb" }, obj: { url: "javascript:alert(1)" } } }), [{ url: "https://fal.media/cat.glb", name: "GLB", kind: "file" }]);
  const signal = new AbortController().signal;
  const task: Generation = { id: "1", category: "picture", model: "selected/image", prompt: "cat", status: "Waiting" };
  const files = await generate(task, async (provider, options) => {
    assert.equal(provider, "openrouter");
    assert.equal(options.model, "selected/image");
    assert.equal(options.action, "image");
    return { data: [{ b64_json: "abc", media_type: "image/png" }] };
  }, signal, () => {});
  assert.equal(files[0].url, "data:image/png;base64,abc");
  const actions: string[] = [];
  const threeD = await generate({ ...task, category: "3d", model: "selected/3d", requestId: "existing-job" }, async (provider, options) => {
    assert.equal(provider, "fal");
    actions.push(options.action);
    return options.action === "status" ? { status: "COMPLETED" } : { model_urls: { glb: { url: "https://fal.media/cat.glb" } } };
  }, signal, () => {});
  assert.deepEqual(actions, ["status", "result"]);
  assert.equal(threeD[0].name, "GLB");
  const updates: unknown[] = [];
  const videoActions: string[] = [];
  const video = await generate({ ...task, category: "video" }, async (_provider, options) => {
    videoActions.push(options.action);
    return options.action === "video" ? { id: "new-job" } : { status: "completed", urls: ["https://media.test/cat.mp4"] };
  }, signal, (change) => updates.push(change));
  assert.deepEqual(videoActions, ["video", "video-status"]);
  assert.equal(video[0].kind, "video");
  assert.ok(updates.some((value) => (value as { requestId?: string }).requestId === "new-job"));
  await assert.rejects(generate({ ...task, category: "video", requestId: "failed-job" }, async () => ({ status: "failed" }), signal, () => {}), /failed/);
  const stopped = new AbortController();
  stopped.abort();
  let requests = 0;
  await assert.rejects(generate({ ...task, category: "video", requestId: "existing-job" }, async () => { requests++; return {}; }, stopped.signal, () => {}));
  assert.equal(requests, 0);
});

test("Hi3D sends the reference image and reads model_mesh; missing images never submit", async () => {
  const task: Generation = { id: "image-job", category: "3d", model: "hitem3d/hi3d/v3.0/image-to-3d", prompt: "puppy", status: "Waiting" };
  const actions: string[] = [];
  const request = async (_provider: unknown, options: { action: string; input?: unknown }) => {
    actions.push(options.action);
    if (options.action === "submit") {
      assert.deepEqual(options.input, { image_url: "data:image/png;base64,YQ==" });
      return { request_id: "job-1" };
    }
    return options.action === "status" ? { status: "COMPLETED" } : { model_mesh: { url: "https://fal.media/puppy.glb", file_name: "puppy.glb" } };
  };
  await assert.rejects(generate(task, request, new AbortController().signal, () => {}), /Select one image/);
  assert.deepEqual(actions, []);
  const files = await generate(task, request, new AbortController().signal, () => {}, "data:image/png;base64,YQ==");
  assert.deepEqual(actions, ["submit", "status", "result"]);
  assert.equal(files[0].name, "GLB");
  assert.deepEqual(modelFiles({ model_mesh: { url: "javascript:alert(1)" } }), []);
});


test("image generation forwards every selected reference", async () => {
  const images = ["data:image/png;base64,YQ==", "data:image/png;base64,Yg=="];
  await generate({ id: "ref", category: "picture", model: "selected/image", prompt: "edit", status: "Waiting" }, async (_provider, options) => {
    assert.deepEqual(options.images, images);
    return { data: [{ b64_json: "YQ==" }] };
  }, new AbortController().signal, () => {}, undefined, images);
});


test("Stop cancels Fal jobs, including Stop before submission returns an ID", async () => {
  for (const stopDuringSubmit of [true, false]) {
    const controller = new AbortController();
    const actions: string[] = [];
    await assert.rejects(generate({ id: "stop", category: "3d", model: "selected/3d", prompt: "cat", status: "Waiting" }, async (provider, options) => {
      actions.push(options.action);
      if (options.action === "submit") {
        if (stopDuringSubmit) controller.abort();
        assert.equal(options.signal?.aborted, false);
        return { request_id: "job-1" };
      }
      if (options.action === "cancel") {
        assert.equal(provider, "fal");
        assert.equal(options.requestId, "job-1");
        assert.equal(options.signal?.aborted, false);
        return { status: "OK" };
      }
      controller.abort();
      throw new DOMException("Stopped", "AbortError");
    }, controller.signal, () => {}), /Job cancelled at provider/);
    assert.deepEqual(actions, stopDuringSubmit ? ["submit", "cancel"] : ["submit", "status", "cancel"]);
  }
});

test("Stop reports cancellation failure without claiming the job stopped", async () => {
  const controller = new AbortController();
  await assert.rejects(generate({ id: "stop", category: "3d", model: "selected/3d", requestId: "job-1", prompt: "cat", status: "Queued" }, async (_provider, options) => {
    if (options.action === "cancel") throw new Error("offline");
    controller.abort();
    throw new DOMException("Stopped", "AbortError");
  }, controller.signal, () => {}), /Could not confirm job cancellation/);
});

test("image generation forwards a requested aspect ratio with its source references", async () => {
  const files = await generate({ id: "resize", category: "picture", prompt: "Recompose", aspectRatio: "9:16", model: "selected/image", status: "Waiting" }, async (provider, options) => {
    assert.equal(provider, "openrouter");
    assert.equal(options.aspectRatio, "9:16");
    assert.deepEqual(options.images, ["data:image/png;base64,YQ=="]);
    return { data: [{ b64_json: "Yg==", media_type: "image/png" }] };
  }, new AbortController().signal, () => {}, "data:image/png;base64,YQ==");
  assert.equal(files.length, 1);
});

/** The browser pieces the local image path needs: the settings request, pictures loaded by URL and a canvas that records its size. */
function fakeBrowser(sd: unknown, settings: unknown[] = [], picture = { width: 1500, height: 1000 }) {
  const original = globalThis.fetch;
  const loaded: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    if (url === "/api/storage/settings") return Response.json(settings);
    loaded.push(String(url));
    return new Response(String(url));
  }) as typeof fetch;
  Object.assign(globalThis, {
    window: { lomra: { sd } },
    createImageBitmap: async (blob: Blob) => ({ ...(await blob.text() === "data:image/png;base64,cmVzdWx0" ? { width: 576, height: 384 } : picture), close() {} }),
    document: { createElement: () => {
      const canvas = { width: 0, height: 0, fill: "", getContext: () => ({ set fillStyle(value: string) { canvas.fill = value; }, fillRect() {}, drawImage() {} }), toDataURL: () => `data:image/png;base64,${canvas.width}x${canvas.height}${canvas.fill}` };
      return canvas;
    } },
  });
  return { loaded, restore() {
    globalThis.fetch = original;
    for (const name of ["window", "document", "createImageBitmap"]) delete (globalThis as Record<string, unknown>)[name];
  } };
}

const used = { seed: 7, steps: 4, cfg: 1 };

test("local Stable Diffusion runs through the desktop bridge, reports progress and stops with the signal", async () => {
  const task: Generation = { id: "11111111-1111-1111-1111-111111111111", category: "picture", prompt: "a fox", aspectRatio: "16:9", model: "sd/sd-turbo", status: "Waiting" };
  const calls: unknown[] = [];
  let progress: ((event: { runId: string; step: number; total: number }) => void) | undefined;
  let cancelled = "";
  const sd = {
    onProgress: (callback: typeof progress) => { progress = callback; return () => { progress = undefined; }; },
    generate: async (runId: string, input: unknown): Promise<{ image: string; settings: unknown } | { error: string }> => { calls.push([runId, input]); progress?.({ runId, step: 2, total: 4 }); return { image: "data:image/png;base64,YQ==", settings: used }; },
    cancel: (runId: string) => { cancelled = runId; },
  };
  const browser = fakeBrowser(sd);
  try {
    const statuses: string[] = [];
    let kept: Partial<Generation> = {};
    const files = await generate(task, async () => { throw new Error("no provider call"); }, new AbortController().signal, (change) => { kept = { ...kept, ...change }; if (change.status) statuses.push(change.status); });
    assert.deepEqual(files, [{ url: "data:image/png;base64,YQ==", name: "Image 1", kind: "image" }]);
    assert.deepEqual(kept.sd, used);
    assert.equal(kept.startImage, undefined);
    assert.deepEqual(calls, [[task.id, { model: "sd-turbo", prompt: "a fox", aspectRatio: "16:9" }]]);
    assert.ok(statuses.includes("Generating · Step 2 of 4"));
    assert.equal(progress, undefined);
    await assert.rejects(generate(task, async () => ({}), new AbortController().signal, (change) => { kept = change; }, undefined, ["data:image/png;base64,YQ==", "data:image/png;base64,Yg=="]), /one picture at a time/);
    assert.equal(kept.startImage, true);
    await assert.rejects(generate({ ...task, startImage: true }, async () => ({}), new AbortController().signal, () => {}), /Select the picture to edit/);
    assert.equal(calls.length, 1);
    const controller = new AbortController();
    sd.generate = async () => { controller.abort(); return { error: "Stopped." }; };
    // Not an abort error, which the chat words as a hosted request that may still be charged.
    await assert.rejects(generate(task, async () => ({}), controller.signal, () => {}), /^Error: Stopped\.$/);
    assert.equal(cancelled, task.id);
    Object.assign(globalThis, { window: { lomra: {} } });
    await assert.rejects(generate(task, async () => ({}), new AbortController().signal, () => {}), /desktop app/);
  } finally {
    browser.restore();
  }
});

test("local Stable Diffusion redraws one selected picture with the saved settings, and a masked area with the edit's own", async () => {
  const task: Generation = { id: "11111111-1111-1111-1111-111111111111", category: "picture", prompt: "a fox", model: "sd/edit-model", status: "Waiting" };
  const calls: Record<string, unknown>[] = [];
  const sd = {
    onProgress: () => () => {}, cancel: () => {},
    generate: async (_runId: string, input: Record<string, unknown>) => { calls.push(input); return { image: "data:image/png;base64,cmVzdWx0", settings: { ...used, image: true } }; },
  };
  const source = "data:image/jpeg;base64,c291cmNl";
  const { rememberSdSeed, lastSdSeed, changeSdSettings } = await import("@/lib/sd-settings-store");
  rememberSdSeed(1);
  changeSdSettings("edit-model", { seed: 5, strength: 0.4, negativePrompt: "blur" });
  const browser = fakeBrowser(sd);
  const run = (change: Partial<Generation> = {}, images = [source]) => generate({ ...task, ...change }, async () => ({}), new AbortController().signal, () => {}, undefined, images);
  try {
    // Saved strength applies only to edits.
    await run({}, []);
    assert.deepEqual(calls.pop(), { model: "edit-model", prompt: "a fox", seed: 5, negativePrompt: "blur" });
    // The source keeps its shape, and the engine-sized result (576 x 384, also 3:2) is returned untouched.
    assert.deepEqual(await run(), [{ url: "data:image/png;base64,cmVzdWx0", name: "Image 1", kind: "image" }]);
    assert.deepEqual(calls.pop(), { model: "edit-model", prompt: "a fox", seed: 5, negativePrompt: "blur", strength: 0.4, image: "data:image/png;base64,1500x1000#fff" });
    assert.equal(lastSdSeed(), 7);
    // Another aspect ratio crops the source and stretches the result to exactly that shape.
    assert.equal((await run({ aspectRatio: "1:1" }))[0].url, "data:image/png;base64,384x384");
    assert.equal(calls.pop()!.image, "data:image/png;base64,1000x1000#fff");
    // An inpaint keeps the whole picture, a black-backed mask of the same size, and its own settings.
    const mask = "data:image/png;base64,bWFzaw==";
    assert.equal((await run({ aspectRatio: "1:1", sdEdit: { mask, strength: 1, negativePrompt: "object" } }))[0].url, "data:image/png;base64,cmVzdWx0");
    assert.deepEqual(calls.pop(), { model: "edit-model", prompt: "a fox", seed: 5, negativePrompt: "object", strength: 1, image: "data:image/png;base64,1500x1000#fff", mask: "data:image/png;base64,1500x1000#000" });
    assert.ok(browser.loaded.includes(mask));
    // Explicit per-run sdSettings (variations) bypasses and never mutates stored settings.
    await run({ sdSettings: { seed: 99, steps: 8, cfg: 2, negativePrompt: "", strength: 0.65 } });
    assert.deepEqual(calls.pop(), { model: "edit-model", prompt: "a fox", seed: 99, steps: 8, cfg: 2, negativePrompt: "", strength: 0.65, image: "data:image/png;base64,1500x1000#fff" });
    const { sdSettingsOf } = await import("@/lib/sd-settings-store");
    assert.deepEqual(sdSettingsOf("edit-model"), { seed: 5, strength: 0.4, negativePrompt: "blur" });
  } finally {
    browser.restore();
    changeSdSettings("edit-model", {});
  }
});

test("every kind of local run says how many are ahead on the graphics card, then that it is generating", async () => {
  const picture = "data:image/png;base64,YQ==";
  const other = "22222222-2222-2222-2222-222222222222";
  const task = { id: "11111111-1111-1111-1111-111111111111", prompt: "a fox", status: "Waiting" };
  let progress: ((event: Record<string, unknown>) => void) | undefined;
  const api = {
    onProgress: (callback: typeof progress) => { progress = callback; return () => {}; },
    cancel: () => {},
    generate: async (runId: string) => {
      const sd = { step: 0, total: 4 };
      for (const [id, waiting] of [[runId, 2], [other, 5], [runId, 1], [runId, 0]] as const) progress?.({ runId: id, stage: "waiting", ...sd, waiting });
      progress?.({ runId, stage: "shape", step: 1, total: 4 });
      return { image: picture, settings: used, model: "data:model/gltf-binary;base64,Z2xi" };
    },
  };
  const browser = fakeBrowser(api);
  Object.assign(globalThis, { window: { lomra: { sd: api, local3d: api } } });
  const local = { ...task, category: "picture", model: "sd/sd-turbo" } as Generation;
  const runs: [string, Generation, string[]][] = [
    ["text only", local, []],
    ["image to image", local, [picture]],
    ["Picture Editor", { ...local, sdEdit: { mask: picture } }, [picture]],
    ["3D", { ...task, category: "3d", model: "local3d/triposr" } as Generation, [picture]],
  ];
  try {
    for (const [name, run, images] of runs) {
      const statuses: string[] = [];
      await generate(run, async () => { throw new Error("no provider call"); }, new AbortController().signal, (change) => { if (change.status) statuses.push(change.status); }, images[0], images);
      assert.deepEqual(statuses, ["Generating · Locally", "Queued · GPU queue · 2 ahead", "Queued · GPU queue · 1 ahead", "Generating · Locally", name === "3D" ? "Generating · Making the 3D shape" : "Generating · Step 1 of 4"], name);
    }
  } finally {
    browser.restore();
  }
});

test("a local 3D model sends one picture through the desktop bridge, returns a GLB and skips the Fal job flow", async () => {
  const picture = "data:image/png;base64,YQ==";
  const task: Generation = { id: "11111111-1111-1111-1111-111111111111", category: "3d", prompt: "a fox", model: "local3d/hunyuan-2mini", status: "Waiting" };
  const calls: unknown[] = [];
  let progress: ((event: { runId: string; stage: string }) => void) | undefined;
  let cancelled = "";
  const local3d = {
    onProgress: (callback: typeof progress) => { progress = callback; return () => { progress = undefined; }; },
    generate: async (runId: string, input: unknown): Promise<{ model: string } | { error: string }> => { calls.push([runId, input]); progress?.({ runId, stage: "shape" }); return { model: "data:model/gltf-binary;base64,Z2xi" }; },
    cancel: (runId: string) => { cancelled = runId; },
  };
  Object.assign(globalThis, { window: { lomra: { local3d } } });
  try {
    assert.equal(requiresImage(task.model), true);
    const statuses: string[] = [];
    const files = await generate(task, async () => { throw new Error("no provider call"); }, new AbortController().signal, (change) => { if (change.status) statuses.push(change.status); }, picture);
    assert.deepEqual(files, [{ url: "data:model/gltf-binary;base64,Z2xi", name: "GLB", kind: "file" }]);
    assert.deepEqual(calls, [[task.id, { model: "hunyuan-2mini", image: picture }]]);
    assert.ok(statuses.includes("Generating · Making the 3D shape"));
    assert.equal(progress, undefined);
    assert.deepEqual(canvasResults(files, "3d"), files);
    await assert.rejects(generate(task, async () => ({}), new AbortController().signal, () => {}), /PNG, JPEG or WebP/);
    await assert.rejects(generate(task, async () => ({}), new AbortController().signal, () => {}, "https://example.com/a.png"), /PNG, JPEG or WebP/);
    const controller = new AbortController();
    local3d.generate = async () => { controller.abort(); return { error: "Stopped." }; };
    await assert.rejects(generate(task, async () => ({}), controller.signal, () => {}, picture));
    assert.equal(cancelled, task.id);
    Object.assign(globalThis, { window: { lomra: {} } });
    await assert.rejects(generate(task, async () => ({}), new AbortController().signal, () => {}, picture), /desktop app/);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("local and hosted picture generation enforces profile capabilities and forwards full few-step settings", async () => {
  const picture = "data:image/png;base64,YQ==";
  const calls: Record<string, unknown>[] = [];
  const fakeStatus = {
    supported: true, engine: true, engineBytes: 0, gpuBytes: 0, downloading: null, queued: [], error: null, profiles: [],
    models: [
      {
        id: "sd-turbo", name: "SD Turbo", quality: "Fast", note: "", bytes: 1, recommended: true, installed: true, partial: 0, custom: false, inpaint: false,
        profile: {
          id: "turbo", name: "Turbo", note: "", size: 512, steps: 4, cfg: 1, strength: 0.75,
          ranges: { steps: { min: 1, max: 50, whole: true }, cfg: { min: 0, max: 20, whole: false }, strength: { min: 0, max: 1, whole: false } },
          capabilities: { textToImage: true, imageToImage: true, inpaint: true, negativePrompt: true, cfg: true, strength: true, outpaint: false, referencePictures: false },
        },
      },
      {
        id: "no-inpaint", name: "No Inpaint", quality: "", note: "", bytes: 1, recommended: false, installed: true, partial: 0, custom: true, inpaint: false,
        profile: {
          id: "no-inpaint", name: "No Inpaint", note: "", size: 512, steps: 4, cfg: 1, strength: 0.75,
          ranges: { steps: { min: 1, max: 12, whole: true }, cfg: { min: 1, max: 1, whole: false }, strength: { min: 0, max: 1, whole: false } },
          capabilities: { textToImage: false, imageToImage: true, inpaint: false, negativePrompt: false, cfg: false, strength: true, outpaint: false, referencePictures: false },
        },
      },
    ],
  };
  const sd = {
    status: async () => fakeStatus,
    onProgress: () => () => {},
    cancel: () => {},
    generate: async (_runId: string, input: Record<string, unknown>) => { calls.push(input); return { image: picture, settings: used }; },
  };
  const { changeSdSettings } = await import("@/lib/sd-settings-store");
  changeSdSettings("sd-turbo", { negativePrompt: "blur", cfg: 1.5, steps: 16 });
  changeSdSettings("no-inpaint", { negativePrompt: "blur", cfg: 7, steps: 4 });
  const browser = fakeBrowser(sd);
  try {
    await generate({ id: "11111111-1111-1111-1111-111111111111", category: "picture", prompt: "fox", model: "sd/sd-turbo", status: "Waiting" }, async () => ({}), new AbortController().signal, () => {});
    assert.deepEqual(calls.pop(), { model: "sd-turbo", prompt: "fox", negativePrompt: "blur", cfg: 1.5, steps: 16 });
    await generate({ id: "11111111-1111-1111-1111-111111111114", category: "picture", prompt: "fox", model: "sd/no-inpaint", status: "Waiting" }, async () => ({}), new AbortController().signal, () => {}, picture, [picture]);
    assert.deepEqual(calls.pop(), { model: "sd/no-inpaint".slice(3), prompt: "fox", steps: 4, image: "data:image/png;base64,1500x1000#fff" });
    const variant: Generation = { id: "variant", category: "picture", prompt: "fox", model: "sd/no-inpaint", status: "Waiting", sdSettings: { steps: 8, cfg: 8, negativePrompt: "blur", strength: 0.6 } };
    await generate(variant, async () => ({}), new AbortController().signal, () => {}, picture, [picture]);
    assert.deepEqual(calls.pop(), { model: "no-inpaint", prompt: "fox", steps: 8, strength: 0.6, image: "data:image/png;base64,1500x1000#fff" });
    await assert.rejects(generate({ ...variant, sdSettings: { steps: 13 } }, async () => ({}), new AbortController().signal, () => {}, picture, [picture]), /Recorded Steps.*outside the current profile range/);
    assert.equal(calls.length, 0);
    await assert.rejects(generate({ id: "11111111-1111-1111-1111-111111111112", category: "picture", prompt: "fox", model: "sd/no-inpaint", status: "Waiting" }, async () => ({}), new AbortController().signal, () => {}), /Select a picture/);
    await assert.rejects(generate({ id: "11111111-1111-1111-1111-111111111113", category: "picture", prompt: "fox", model: "sd/no-inpaint", sdEdit: { mask: picture }, status: "Waiting" }, async () => ({}), new AbortController().signal, () => {}, picture, [picture]), /cannot edit a brushed area/);
    await assert.rejects(generate({ id: "g1", category: "picture", prompt: "fox", model: "google-ai/imagen-3", status: "Waiting" }, async () => ({}), new AbortController().signal, () => {}, picture, [picture]), /does not support reference images/);
  } finally {
    browser.restore();
    changeSdSettings("sd-turbo", {});
    changeSdSettings("no-inpaint", {});
  }
});
