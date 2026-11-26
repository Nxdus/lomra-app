import assert from "node:assert/strict";
import test from "node:test";
import { generate, type Generation } from "./generation";
import { mediaToolModel, validateMediaTool, localMediaTool, type MediaTool } from "./media-tools";
import { generationPlan } from "@/app/api/providers/generation-tools";

test("media tools route validated parameters and reject unsafe ranges", () => {
  const tools: MediaTool[] = [
    { name: "remove_background", image_index: 0 },
    { name: "upscale_image", image_index: 1, scale: 4 },
    { name: "extract_video_frames", video_index: 0, timestamps: [0, 1.5] },
    { name: "trim_video", video_index: 1, start: 2, end: 5 },
    { name: "render_3d_views", model_index: 0, views: ["front", "right", "back", "left"] },
    { name: "inspect_3d", model_index: 0 },
    { name: "optimize_3d", model_index: 1, max_texture_size: 1024 },
    { name: "optimize_3d", model_index: 0, target_triangles: 100000, language: "th" },
    { name: "optimize_3d", model_index: 0, target_triangles: 0 },
  ];
  for (const tool of tools) {
    const { name, ...args } = tool;
    const plan = generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify({ prompt: "edit", ...args }) } }] } }] });
    assert.deepEqual(plan.tasks[0], { category: name === "inspect_3d" || name === "optimize_3d" ? "3d" : name === "trim_video" ? "video" : "picture", prompt: "edit", mediaTool: tool });
  }
  for (const invalid of [
    { name: "upscale_image", image_index: 0, scale: 100 },
    { name: "remove_background", image_index: -1 },
    { name: "trim_video", video_index: 0, start: 10, end: 5 },
    { name: "trim_video", video_index: 0, start: 0, end: 121 },
    { name: "extract_video_frames", video_index: 0, timestamps: [NaN] },
    { name: "extract_video_frames", video_index: 0, timestamps: [] },
    { name: "render_3d_views", model_index: 0, views: ["front", "front"] },
    { name: "render_3d_views", model_index: 0, views: ["__proto__"] },
    { name: "inspect_3d", model_index: -1 },
    { name: "optimize_3d", model_index: 0, max_texture_size: 100000 },
    { name: "optimize_3d", model_index: 0, language: "invalid" },
    ...[-1, 1, 3, 4.5, "1000", null, Infinity, 5000001].map(target_triangles => ({ name: "optimize_3d", model_index: 0, target_triangles })),
  ]) assert.throws(() => validateMediaTool(invalid), /Invalid/);
});

test("Fal image tools submit the selected image and can resume without resubmission", async () => {
  for (const mediaTool of [{ name: "remove_background", image_index: 1 }, { name: "upscale_image", image_index: 1, scale: 2 }] as MediaTool[]) {
    const task: Generation = { id: "tool", category: "picture", prompt: "edit", model: mediaToolModel(mediaTool), status: "Waiting", mediaTool };
    const calls: string[] = [];
    const request: Parameters<typeof generate>[1] = async (provider, options) => {
      assert.equal(provider, "fal");
      assert.equal(options.model, task.model);
      calls.push(options.action);
      if (options.action === "submit") {
        assert.deepEqual(options.input, { image_url: "data:image/png;base64,Yg==", output_format: "png", ...(mediaTool.name === "upscale_image" ? { scale: 2 } : {}) });
        return { request_id: "job-1" };
      }
      return options.action === "status" ? { status: "COMPLETED" } : { image: { url: "https://fal.media/output.png" } };
    };
    const signal = new AbortController().signal;
    const output = await generate(task, request, signal, () => {}, undefined, ["data:image/png;base64,YQ==", "data:image/png;base64,Yg=="]);
    assert.equal(output[0].kind, "image");
    assert.deepEqual(calls, ["submit", "status", "result"]);
    calls.length = 0;
    await generate({ ...task, requestId: "job-1" }, request, signal, () => {});
    assert.deepEqual(calls, ["status", "result"]);
    calls.length = 0;
    await assert.rejects(generate(task, request, signal, () => {}), /Select the source image/);
    assert.deepEqual(calls, []);
  }
});

test("local tools reject absent sources and honor cancellation before processing", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(localMediaTool({ name: "render_3d_views", model_index: 0, views: ["front"] }, [], signal), /Select a GLB/);
  await assert.rejects(localMediaTool({ name: "trim_video", video_index: 0, start: 0, end: 1 }, [], signal), /Select a video/);
  await assert.rejects(localMediaTool({ name: "inspect_3d", model_index: 0 }, [], signal), /Select a GLB/);
  await assert.rejects(localMediaTool({ name: "extract_video_frames", video_index: 0, timestamps: [0] }, [], AbortSignal.abort()));
});

test("local desktop picture tools route locally without Fal, report progress, honor cancel, and never fall back to Fal on failure", async () => {
  const calls: unknown[] = [];
  let progress: ((event: { runId: string; stage: string; done?: number; total?: number }) => void) | undefined;
  let cancelled = "";
  const picture = {
    onProgress: (cb: typeof progress) => { progress = cb; return () => { progress = undefined; }; },
    run: async (runId: string, input: unknown): Promise<{ image: string; model: string } | { error: string }> => {
      calls.push([runId, input]);
      progress?.({ runId, stage: "processing", done: 1, total: 2 });
      return { image: "data:image/png;base64,b3V0", model: "realesrgan-x4v3" };
    },
    cancel: (runId: string) => { cancelled = runId; },
  };
  Object.assign(globalThis, { window: { lomra: { picture } } });
  const providerMustNotRun: Parameters<typeof generate>[1] = async () => { throw new Error("Must not call Fal"); };
  try {
    const statuses: string[] = [];
    const bgTask: Generation = { id: "11111111-1111-1111-1111-111111111111", category: "picture", prompt: "remove bg", model: mediaToolModel({ name: "remove_background", image_index: 0 }, "birefnet-lite"), status: "Waiting", mediaTool: { name: "remove_background", image_index: 0 } };
    const bg = await generate(bgTask, providerMustNotRun, new AbortController().signal, (c) => { if (c.status) statuses.push(c.status); }, undefined, ["data:image/png;base64,YQ=="]);
    assert.deepEqual(bg, [{ url: "data:image/png;base64,b3V0", name: "Background removed", kind: "image" }]);
    assert.deepEqual(calls[0], [bgTask.id, { operation: "remove-background", image: "data:image/png;base64,YQ==" }]);

    const upTask: Generation = { id: "22222222-2222-2222-2222-222222222222", category: "picture", prompt: "upscale", model: mediaToolModel({ name: "upscale_image", image_index: 0, scale: 4 }, "realesrgan-x4v3"), status: "Waiting", mediaTool: { name: "upscale_image", image_index: 0, scale: 4 } };
    const up = await generate(upTask, providerMustNotRun, new AbortController().signal, (c) => { if (c.status) statuses.push(c.status); }, undefined, ["data:image/png;base64,YQ=="]);
    assert.deepEqual(up, [{ url: "data:image/png;base64,b3V0", name: "Upscaled 4x", kind: "image" }]);
    assert.ok(statuses.includes("Generating · Upscaling locally 1/2"));
    assert.equal(progress, undefined);

    // Local failure must not fall back to Fal.
    picture.run = async () => ({ error: "Output exceeds limit." });
    await assert.rejects(generate(upTask, providerMustNotRun, new AbortController().signal, () => {}, undefined, ["data:image/png;base64,YQ=="]), /Output exceeds limit/);

    // Cancellation stops the run.
    const controller = new AbortController();
    picture.run = async () => { controller.abort(); return { error: "Stopped." }; };
    await assert.rejects(generate(upTask, providerMustNotRun, controller.signal, () => {}, undefined, ["data:image/png;base64,YQ=="]), /Stopped/);
    assert.equal(cancelled, upTask.id);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
