import assert from "node:assert/strict";
import test from "node:test";
import { animationInput, animationFiles, rigFiles } from "./animation";
import { generate, canvasResults } from "./generation";
import { validateMediaTool } from "./media-tools";
import { generationPlan } from "../../app/api/providers/generation-tools";
import { POST } from "../../app/api/providers/route";

test("animation proxy rejects unsupported presets and arbitrary model URLs", async () => {
  for (const input of [
    { model_url: "https://example.com/person.glb", enable_animation: true, animation_action_id: 28 },
    { model_url: "data:model/gltf-binary;base64,Z2xURgIAAAAMAAAA", enable_animation: true, animation_action_id: 999 },
  ]) {
    const response = await POST(new Request("http://localhost/api/providers", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "test" }, body: JSON.stringify({ provider: "fal", model: "fal-ai/meshy/rigging", action: "submit", input }) }));
    assert.equal(response.status, 400);
  }
});

test("animation routes, uploads selected GLB and returns animated downloads", async () => {
  const mediaTool = { name: "animate_3d", model_index: 0, animation: "wave" } as const;
  const plan = generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "animate_3d", arguments: JSON.stringify({ ...mediaTool, prompt: "wave" }) } }] } }] });
  assert.equal(plan.tasks[0].category, "3d");
  assert.deepEqual(plan.tasks[0].mediaTool, mediaTool);
  const sources = [{ file: new File([new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0, 12, 0, 0, 0])], "person.glb"), url: "blob:person" }];
  const files = await generate({ id: "animation", category: "3d", prompt: "wave", model: "fal-ai/meshy/rigging", status: "Waiting", mediaTool }, async (provider, options) => {
    assert.equal(provider, "fal");
    if (options.action === "submit") {
      const input = options.input as { model_url: string; animation_action_id: number; enable_animation: boolean };
      assert.match(input.model_url, /^data:model\/gltf-binary;base64,Z2xURg/);
      assert.equal(input.animation_action_id, 28);
      assert.equal(input.enable_animation, true);
      return { request_id: "job" };
    }
    if (options.action === "status") return { status: "COMPLETED" };
    return { rigged_character_glb: { url: "https://fal.media/rig.glb" }, animation_glb: { url: "https://fal.media/wave.glb" }, animation_fbx: { url: "https://fal.media/wave.fbx" } };
  }, new AbortController().signal, () => {}, undefined, [], sources);
  assert.equal(canvasResults(files, "3d")[0].url, "https://fal.media/wave.glb");
  assert.equal(files.length, 2);
});

test("animation rejects missing/invalid models, unknown motions and static results", async () => {
  const tool = { name: "animate_3d", model_index: 0, animation: "walk" } as const;
  const signal = new AbortController().signal;
  await assert.rejects(animationInput(tool, [], signal), /Select a humanoid/);
  await assert.rejects(animationInput(tool, [{ file: new File(["invalid"], "bad.glb"), url: "blob:bad" }], signal), /valid GLB/);
  assert.throws(() => validateMediaTool({ ...tool, animation: "fly" }), /Invalid/);
  assert.throws(() => validateMediaTool({ ...tool, model_index: -1 }), /Invalid/);
  assert.throws(() => animationFiles({ rigged_character_glb: { url: "https://fal.media/static.glb" } }), /no animated GLB/);
  assert.throws(() => animationFiles({ animation_glb: { url: "javascript:alert(1)" } }), /no animated GLB/);
});

test("custom motion preserves detailed text, uses Fal and resumes saved stages without resubmitting", async () => {
  const tool = { name: "animate_3d", model_index: 0, motion_prompt: "A short-legged chubby character waddles with short steps, arms clear of belly.", duration: 4 } as const;
  validateMediaTool(tool);
  const plan = generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "animate_3d", arguments: JSON.stringify({ ...tool, prompt: "walk" }) } }] } }] });
  assert.deepEqual(plan.tasks[0].mediaTool, tool);
  assert.throws(() => validateMediaTool({ ...tool, motion_prompt: " ".repeat(5) }), /Invalid/);
  assert.throws(() => validateMediaTool({ ...tool, duration: 2.25 }), /Invalid/);
  assert.throws(() => validateMediaTool({ ...tool, animation: "walk" }), /Invalid/);
  const task = { id: "custom", category: "3d", prompt: "walk", model: "fal-ai/hunyuan-motion", status: "Interrupted", mediaTool: tool, requestId: "rig-job", motionJobs: { rig: "rig-job" } } as const;
  const updates: unknown[] = [];
  const submissions: string[] = [];
  await assert.rejects(generate(task, async (provider, options) => {
    assert.equal(provider, "fal");
    if (options.action === "submit") {
      submissions.push(options.model!);
      assert.deepEqual(options.input, { prompt: tool.motion_prompt, duration: 4, output_format: "fbx" });
      return { request_id: "motion-job" };
    }
    if (options.action === "status") return { status: "COMPLETED" };
    return {}; // Missing provider files must fail, never fall back to a preset.
  }, new AbortController().signal, update => updates.push(update)), /no rigged GLB or motion FBX/);
  assert.deepEqual(submissions, ["fal-ai/hunyuan-motion"]);
  assert.ok(updates.some(update => JSON.stringify(update).includes('"motionJobs":{"rig":"rig-job","motion":"motion-job"}')));
  await assert.rejects(generate({ ...task, motionJobs: { rig: "rig-job", motion: "motion-job" } }, async (_provider, options) => {
    assert.notEqual(options.action, "submit");
    return options.action === "status" ? { status: "COMPLETED" } : {};
  }, new AbortController().signal, () => {}), /no rigged GLB/);
});

test("motion API validates input and sends full prompts to Hunyuan without preset IDs", async () => {
  const originalFetch = globalThis.fetch;
  const send = (input: unknown) => POST(new Request("http://localhost/api/providers", { method: "POST", headers: { "x-api-key": "test-key" }, body: JSON.stringify({ provider: "fal", action: "submit", model: "fal-ai/hunyuan-motion", input }) }));
  let calls = 0;
  try {
    globalThis.fetch = (async (url, options) => {
      calls++;
      assert.equal(String(url), "https://queue.fal.run/fal-ai/hunyuan-motion");
      assert.deepEqual(JSON.parse(options?.body as string), { prompt: "Short waddling steps", duration: 4, output_format: "fbx" });
      return Response.json({ request_id: "motion-job" });
    }) as typeof fetch;
    for (const input of [{ prompt: "", duration: 4 }, { prompt: "a".repeat(401), duration: 4 }, { prompt: "walk", duration: 99 }]) assert.equal((await send(input)).status, 400);
    assert.equal(calls, 0);
    assert.equal((await send({ prompt: "Short waddling steps", duration: 4, animation_action_id: 30 })).status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("stopping custom motion retains the submitted ID and starts no additional jobs", async () => {
  const controller = new AbortController();
  let submits = 0;
  let saved: unknown;
  const task = { id: "stop", category: "3d", model: "fal-ai/hunyuan-motion", prompt: "walk", status: "Waiting", mediaTool: { name: "animate_3d", model_index: 0, motion_prompt: "Waddle slowly" } } as const;
  const file = new File([new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0, 12, 0, 0, 0])], "source.glb");
  await assert.rejects(generate(task, async (_provider, options) => {
    assert.equal(options.action, "submit");
    assert.equal(options.model, "fal-ai/meshy/rigging");
    assert.equal((options.input as { enable_animation: boolean }).enable_animation, false);
    submits++; controller.abort(); return { request_id: "rig-job" };
  }, controller.signal, update => { saved = update; }, undefined, [], [{ file, url: "blob:source" }]), /use Check job to resume/);
  assert.equal(submits, 1);
  assert.deepEqual(saved, { motionJobs: { rig: "rig-job" }, requestId: "rig-job" });
});


test("rig-only tool routes, disables animation and returns rigged files", async () => {
  const mediaTool = { name: "rig_3d", model_index: 0 } as const;
  validateMediaTool(mediaTool);
  assert.throws(() => validateMediaTool({ ...mediaTool, model_index: -1 }), /Invalid/);
  const plan = generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "rig_3d", arguments: JSON.stringify({ prompt: "rig only", model_index: 0 }) } }] } }] });
  assert.equal(plan.tasks[0].category, "3d");
  assert.deepEqual(plan.tasks[0].mediaTool, mediaTool);
  const sources = [{ file: new File([new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0, 12, 0, 0, 0])], "person.glb"), url: "blob:person" }];
  const calls: string[] = [];
  const request = async (provider: string, options: { model?: string; action?: string; input?: unknown }) => {
    assert.equal(provider, "fal");
    assert.equal(options.model, "fal-ai/meshy/rigging");
    calls.push(options.action!);
    if (options.action === "submit") {
      const input = options.input as { enable_animation: boolean; animation_action_id?: number; model_url: string };
      assert.equal(input.enable_animation, false);
      assert.equal(input.animation_action_id, undefined);
      assert.match(input.model_url, /^data:model\/gltf-binary;base64,Z2xURg/);
      return { request_id: "rig-only-job" };
    }
    if (options.action === "status") return { status: "COMPLETED" };
    return { rigged_character_glb: { url: "https://fal.media/rig.glb" }, rigged_character_fbx: { url: "https://fal.media/rig.fbx" }, animation_glb: { url: "https://fal.media/unwanted.glb" } };
  };
  const task = { id: "rig-only", category: "3d", prompt: "rig only", model: "fal-ai/meshy/rigging", status: "Waiting", mediaTool } as const;
  const files = await generate(task, request, new AbortController().signal, () => {}, undefined, [], sources);
  assert.deepEqual(files.map(file => file.url), ["https://fal.media/rig.glb", "https://fal.media/rig.fbx"]);
  assert.equal(canvasResults(files, "3d")[0].url, "https://fal.media/rig.glb");
  assert.deepEqual(calls, ["submit", "status", "result"]);
  calls.length = 0;
  await generate({ ...task, requestId: "rig-only-job" }, request, new AbortController().signal, () => {});
  assert.deepEqual(calls, ["status", "result"]);
  assert.throws(() => rigFiles({ animation_glb: { url: "https://fal.media/motion.glb" } }), /no rigged GLB/);
  assert.throws(() => rigFiles({ rigged_character_glb: { url: "http://unsafe.test/rig.glb" } }), /no rigged GLB/);
});
