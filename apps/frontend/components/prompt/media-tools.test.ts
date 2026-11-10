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
  ];
  for (const tool of tools) {
    const { name, ...args } = tool;
    const plan = generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify({ prompt: "edit", ...args }) } }] } }] });
    assert.deepEqual(plan.tasks[0], { category: name === "trim_video" ? "video" : "picture", prompt: "edit", mediaTool: tool });
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
  await assert.rejects(localMediaTool({ name: "extract_video_frames", video_index: 0, timestamps: [0] }, [], AbortSignal.abort()));
});
