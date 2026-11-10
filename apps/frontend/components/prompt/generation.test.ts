import assert from "node:assert/strict";
import test from "node:test";
import { canvasResults, generate, modelFiles, safeMediaUrl, selectedModel, isMultiview, multiviewError, type Generation, type ModelViews } from "./generation";

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
