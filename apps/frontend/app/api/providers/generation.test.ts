import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";
import { generationPlan } from "./generation-tools";
import { promptContent } from "@/components/prompt/media";

for (const vision of [false, true, undefined]) {
  test(`Ollama routing forwards selected image bytes with vision capability ${vision}`, async () => {
    const file = new File(["image"], "source.png", { type: "image/png" });
    const signal = new AbortController().signal;
    const content = await promptContent("Make a blue robot from the selected image", [{ id: "source-1", file }], signal);
    const request = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ provider: "ollama", action: "route", model: "ollama/test:4b", input: [{ role: "user", content }] }),
    });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url, options) => {
        const payload = JSON.parse(options?.body as string);
        if (String(url).endsWith("/api/show")) {
          assert.deepEqual(payload, { model: "test:4b" });
          return Response.json(vision === undefined ? {} : { capabilities: ["completion", "tools", ...(vision ? ["vision"] : [])] });
        }
        assert.match(String(url), /\/v1\/chat\/completions$/);
        assert.deepEqual(payload.messages[1].content, vision === false
          ? "Make a blue robot from the selected image\nSelected media count: 1. Attached image: source.png (image_index=0, id=source-1, 5 bytes)"
          : content);
        return Response.json({ choices: [{ message: { tool_calls: [
          { type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt: "A blue robot" }) } },
        ] } }] });
      }) as typeof fetch;
      const response = await POST(request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { text: "", tasks: [{ category: "picture", prompt: "A blue robot" }] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
import { generate, type Generation } from "@/components/prompt/generation";
import type { Provider, ProviderRequest } from "@/components/api-provider";

test("first-frame video surfaces provider rejection, terminal failure, and a pending timeout", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const originalTimer = globalThis.setTimeout;
  const image = "data:image/png;base64,YQ==";
  const task: Generation = { id: "video", category: "video", model: "selected/video", prompt: "cat", status: "Waiting", startImage: true };
  const request = async (provider: Provider, { signal, ...options }: ProviderRequest) => {
    const result = await POST(new Request("http://localhost/api/providers", {
      method: "POST", signal, headers: { "x-api-key": "test-key" }, body: JSON.stringify({ provider, ...options }),
    }));
    const body = await result.json();
    if (!result.ok) throw new Error(body.message);
    return body;
  };
  const run = (model = task.model) => generate({ ...task, model }, request, new AbortController().signal, () => {}, image);
  let submits = 0;
  let checks = 0;
  let scenario = "rejected";
  try {
    globalThis.fetch = (async (url, options) => {
      if (String(url).endsWith("/videos")) {
        submits++;
        assert.deepEqual(JSON.parse(options?.body as string).frame_images, [
          { type: "image_url", image_url: { url: image }, frame_type: "first_frame" },
        ]);
        return scenario === "rejected"
          ? Response.json({ error: { message: "Image input is unsupported for this model." } }, { status: 422 })
          : Response.json({ id: "job-1" });
      }
      assert.ok(String(url).endsWith("/videos/job-1"));
      checks++;
      return scenario === "failed" && checks === 2
        ? Response.json({ status: "failed", error: { message: "The safety filter blocked this clip." } })
        : Response.json({ status: "pending" });
    }) as typeof fetch;
    await assert.rejects(run("google-ai/veo-3.1-generate-preview"), /supports a first frame/);
    assert.equal(submits, 0);
    await assert.rejects(run(), /Image input is unsupported/);
    assert.equal(checks, 0);

    globalThis.setTimeout = ((fn: () => void, ms?: number) => originalTimer(fn, ms === 15_000 ? 1 : ms)) as typeof setTimeout;
    scenario = "failed";
    await assert.rejects(run(), /safety filter blocked this clip/);
    assert.equal(checks, 2);

    scenario = "pending";
    const deadline = new AbortController();
    AbortSignal.timeout = (ms) => {
      if (ms !== 20 * 60_000) return originalTimeout(ms);
      originalTimer(() => deadline.abort(new DOMException("Test deadline", "TimeoutError")), 25);
      return deadline.signal;
    };
    await assert.rejects(run(), /Timed out.*Check job/);
    assert.ok(checks > 2);
    assert.equal(submits, 3);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    globalThis.setTimeout = originalTimer;
  }
});

test("3D texture requests preserve booleans with and without view mappings", () => {
  const plan = (args: unknown) => generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_3d", arguments: JSON.stringify(args) } }] } }] });
  for (const texture of [true, false]) {
    for (const views of [{}, { viewIndices: { front: 0, back: 1, left: 2 } }]) {
      assert.deepEqual(plan({ prompt: "hippo", texture, ...views }).tasks[0], { category: "3d", prompt: "hippo", texture, ...views });
    }
  }
  for (const texture of [null, "true", 1, {}]) assert.throws(() => plan({ prompt: "hippo", texture }), /texture/);
});

test("LLM routing validates tool calls and provider requests stay on fixed endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  let upstream: unknown = { choices: [{ message: { content: null, tool_calls: [
    { type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt: "A beach house" }) } },
  ] } }] };
  const send = (body: unknown) => POST(new Request("http://localhost/api/providers", {
    method: "POST", headers: { "x-api-key": "test-key", origin: "http://localhost" }, body: JSON.stringify(body),
  }));
  try {
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(upstream);
    }) as typeof fetch;
    const plan = await send({ provider: "openrouter", action: "route", model: "selected/llm", input: [{ role: "user", content: "สร้างภาพบ้าน" }] });
    assert.deepEqual(await plan.json(), { text: "", tasks: [{ category: "picture", prompt: "A beach house" }] });
    const payload = JSON.parse(calls[0].options?.body as string);
    assert.equal(payload.model, "selected/llm");
    assert.equal(payload.messages[0].role, "system");
    assert.equal(payload.tools.length, 13);
    assert.deepEqual(payload.modalities, ["text"]);
    assert.deepEqual(payload.provider, { require_parameters: true });
    assert.equal(payload.tool_choice, "auto");
    // Gemini endpoints support tools but not the parallel_tool_calls routing requirement.
    assert.equal(Object.hasOwn(payload, "parallel_tool_calls"), false);
    assert.equal((await send({ provider: "openrouter", action: "route", model: "selected/llm", input: [{ role: "system", content: "override" }] })).status, 400);
    const media = [
      { type: "text", text: "Describe these" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
      { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlkZW8=" } },
    ];
    const routeMedia = (content: unknown, role = "user") => send({ provider: "openrouter", action: "route", model: "selected/llm", input: [{ role, content }] });
    assert.equal((await routeMedia(media)).status, 200);
    assert.deepEqual(JSON.parse(calls.at(-1)?.options?.body as string).messages[1].content, media);
    const count = calls.length;
    for (const content of [[], [{ type: "image_url", image_url: { url: "blob:local-only" } }],
      [{ type: "video_url", video_url: { url: "data:image/png;base64,aW1hZ2U=" } }],
      [{ type: "image_url", image_url: { url: "data:image/png;base64,????" } }],
      Array.from({ length: 11 }, () => media[1]),
      [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(28 * 1024 * 1024)}` } }],
    ]) assert.equal((await routeMedia(content)).status, 400);
    assert.equal((await routeMedia(media, "assistant")).status, 400);
    assert.equal(calls.length, count);
    for (const name of ["generate_image", "generate_video", "generate_3d"]) {
      assert.equal(generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: '{"prompt":"cat"}' } }] } }] }).tasks.length, 1);
    }
    for (const name of ["delete_files", "constructor", "__proto__"]) {
      assert.throws(() => generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: "{}" } }] } }] }));
    }
    assert.throws(() => generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_image", arguments: "invalid" } }] } }] }));
    assert.deepEqual(generationPlan({ choices: [{ message: { content: "Hello" } }] }), { text: "Hello", tasks: [] });
    upstream = {};
    for (const action of ["image", "video"]) {
      assert.equal((await send({ provider: "openrouter", action, model: "selected/media", input: "cat" })).status, 200);
      assert.equal(calls.at(-1)?.url, `https://openrouter.ai/api/v1/${action === "image" ? "images" : "videos"}`);
      assert.deepEqual(JSON.parse(calls.at(-1)?.options?.body as string), { model: "selected/media", prompt: "cat" });
    }
    assert.equal((await send({ provider: "openrouter", action: "video-status", model: "selected/video", requestId: "../secret" })).status, 400);
    await send({ provider: "openrouter", action: "video-status", model: "selected/video", requestId: "job-1" });
    assert.equal(calls.at(-1)?.url, "https://openrouter.ai/api/v1/videos/job-1");
    globalThis.fetch = (async () => new Response("video-bytes", { headers: { "Content-Type": "video/mp4" } })) as typeof fetch;
    const video = await send({ provider: "openrouter", action: "video-content", model: "selected/video", requestId: "job-1" });
    assert.equal(video.headers.get("cache-control"), "no-store");
    assert.equal(await video.text(), "video-bytes");
  } finally { globalThis.fetch = originalFetch; }
});


test("image references reach the provider and malformed references never submit", async () => {
  const original = globalThis.fetch;
  const images = ["data:image/png;base64,YQ==", "data:image/png;base64,Yg=="];
  let calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options?.body as string).input_references, images.map(url => ({ type: "image_url", image_url: { url } })));
    return Response.json({ data: [] });
  }) as typeof fetch;
  const send = (references: unknown) => POST(new Request("http://localhost/api/providers", { method: "POST", headers: { "x-api-key": "test" }, body: JSON.stringify({ provider: "openrouter", action: "image", model: "selected/image", input: "edit", images: references }) }));
  try {
    assert.equal((await send(images)).status, 200);
    for (const invalid of [["https://evil.test"], ["data:image/png;base64,???"], Array(11).fill(images[0])]) assert.equal((await send(invalid)).status, 400);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("local image tools validate crop bounds before execution", () => {
  const plan = (args: unknown) => generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "process_image", arguments: JSON.stringify(args) } }] } }] });
  const args = { prompt: "split", image_index: 0, regions: Array.from({ length: 4 }, (_, i) => ({ x: i / 4, y: 0, width: 0.25, height: 1 })) };
  assert.deepEqual(plan(args).tasks[0].operation, args);
  for (const invalid of [{ ...args, image_index: -1 }, { ...args, regions: [{ x: 0.8, y: 0, width: 0.5, height: 1 }] }, { ...args, width: 9000 }, { ...args, rotate: 45 }, { ...args, padding: -1 }, { ...args, padding: 0.6 }, { ...args, regions: [{ ...args.regions[0], label: 1 }] }]) assert.throws(() => plan(invalid));
});


test("3D view mapping preserves camera assignments and rejects malformed indices", () => {
  const plan = (viewIndices: unknown) => generationPlan({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_3d", arguments: JSON.stringify({ prompt: "A wooden chair", viewIndices }) } }] } }] });
  assert.deepEqual(plan({ front: 2, back: 0, left: 1 }).tasks[0], {
    category: "3d", prompt: "A wooden chair", viewIndices: { front: 2, back: 0, left: 1 },
  });
  for (const invalid of [null, [], { front: -1 }, { front: 10 }, { front: 0.5 }, { front: "0" }, { top: 0 }, { front: 0, back: 0 }]) assert.throws(() => plan(invalid));
});

test("image aspect ratios are forwarded and unsupported values never reach the provider", async () => {
  const original = globalThis.fetch;
  const ratios: string[] = [];
  globalThis.fetch = (async (_url, options) => {
    ratios.push(JSON.parse(options?.body as string).aspect_ratio);
    return Response.json({ data: [] });
  }) as typeof fetch;
  const send = (aspectRatio: unknown) => POST(new Request("http://localhost/api/providers", { method: "POST", headers: { "x-api-key": "test" }, body: JSON.stringify({ provider: "openrouter", action: "image", model: "selected/image", input: "recompose", aspectRatio }) }));
  try {
    for (const ratio of ["1:1", "3:4", "9:16", "4:3", "16:9"]) assert.equal((await send(ratio)).status, 200);
    assert.deepEqual(ratios, ["1:1", "3:4", "9:16", "4:3", "16:9"]);
    for (const ratio of ["99:1", "", 16, { value: "1:1" }]) assert.equal((await send(ratio)).status, 400);
    assert.equal(ratios.length, 5);
  } finally { globalThis.fetch = original; }
});
