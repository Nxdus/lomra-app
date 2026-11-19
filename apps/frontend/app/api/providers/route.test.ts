import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("provider proxy validates requests, isolates keys and hides upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  function request(body: unknown, key = "test-key", origin = "http://localhost", host = "localhost") {
    return new Request("http://localhost/api/providers", {
      method: "POST", headers: { "x-api-key": key, origin, host }, body: JSON.stringify(body),
    });
  }
  try {
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ data: {}, request_id: "job-1" });
    }) as typeof fetch;
    for (const body of [null, {}, { provider: "other" },
      { provider: "fal", action: "submit", model: "fal-ai/../private", input: {} },
      { provider: "fal", action: "submit", model: "https://evil.test", input: {} },
      { provider: "fal", action: "submit", model: "fal-ai/flux/dev", input: [] },
      { provider: "fal", action: "result", model: "fal-ai/flux/dev", requestId: "../other" },
      { provider: "openrouter", action: "chat", model: "openai/test", input: [{ role: "user" }] },
    ]) assert.equal((await POST(request(body))).status, 400);
    assert.equal((await POST(request({ provider: "fal", action: "verify" }, ""))).status, 400);
    assert.equal((await POST(request({}, "test", "https://evil.test"))).status, 403);
    assert.equal((await POST(request({}, "test", "http://localhost", "127.0.0.1:3000"))).status, 403);
    assert.equal((await POST(request({}, "test", "https://127.0.0.1:3000", "127.0.0.1:3000"))).status, 403);
    assert.equal((await POST(new Request("http://localhost/api/providers", {
      method: "POST", headers: { "x-api-key": "test-key" }, body: "invalid",
    }))).status, 400);
    assert.equal(calls.length, 0);

    const desktopResult = await POST(request(
      { provider: "openrouter", action: "verify" }, "test-key", "http://127.0.0.1:3000", "127.0.0.1:3000",
    ));
    assert.deepEqual(await desktopResult.json(), { connected: true });

    for (const [provider, key, expected] of [
      ["openrouter", "user-a", "Bearer user-a"], ["fal", "user-b", "Key user-b"],
    ]) {
      const result = await POST(request({ provider, action: "verify" }, key));
      assert.deepEqual(await result.json(), { connected: true });
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal((calls.at(-1)?.options?.headers as Record<string, string>).Authorization, expected);
      assert.equal(calls.at(-1)?.options?.cache, "no-store");
      assert.equal(calls.at(-1)?.options?.redirect, "error");
    }
    const input = [{ role: "user", content: "Hello" }];
    await POST(request({ provider: "openrouter", action: "chat", model: "openai/test", input }));
    assert.equal(calls.at(-1)?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.deepEqual(JSON.parse(calls.at(-1)?.options?.body as string), { model: "openai/test", messages: input, stream: true });
    await POST(request({ provider: "fal", action: "submit", model: "fal-ai/flux/dev", input: { prompt: "cat" } }));
    assert.equal(calls.at(-1)?.url, "https://queue.fal.run/fal-ai/flux/dev");
    for (const action of ["status", "result", "cancel"]) {
      await POST(request({ provider: "fal", action, model: "fal-ai/flux/dev", requestId: "job-1" }));
      assert.equal(calls.at(-1)?.url, `https://queue.fal.run/fal-ai/flux/requests/job-1${action === "status" ? "/status" : action === "cancel" ? "/cancel" : ""}`);
      assert.equal(calls.at(-1)?.options?.method, action === "cancel" ? "PUT" : "GET");
    }
    const usageRequest = (provider = "openrouter", action = "usage") => request({ provider, action }, provider === "fal" ? "test-key:test-secret" : "test-key");
    assert.equal((await POST(request({ provider: "fal", action: "usage" }))).status, 400);
    let upstream: unknown = { data: { usage: 12.25, usage_monthly: 0, limit_remaining: 0, label: "private" } };
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(upstream);
    }) as typeof fetch;
    const usage = await POST(usageRequest());
    assert.deepEqual(await usage.json(), { metrics: [
      { label: "Key usage · All time", amount: 12.25 },
      { label: "Key usage · This month", amount: 0 },
      { label: "Key limit remaining", amount: 0 },
    ] });
    assert.equal(calls.at(-1)?.url, "https://openrouter.ai/api/v1/key");
    assert.equal(usage.headers.get("cache-control"), "no-store");
    upstream = { data: { usage: 0, limit_remaining: null } };
    assert.deepEqual(await (await POST(usageRequest())).json(), { metrics: [{ label: "Key usage · All time", amount: 0 }] });
    for (const data of [{}, { usage: "1" }, { usage: null }]) {
      upstream = { data };
      assert.equal((await POST(usageRequest())).status, 502);
    }
    upstream = { credits: { current_balance: 0, currency: "USD" } };
    assert.deepEqual(await (await POST(usageRequest("fal", "credits"))).json(), { metrics: [{ label: "Account balance", amount: 0 }] });
    assert.equal(calls.at(-1)?.url, "https://api.fal.ai/v1/account/billing?expand=credits");
    for (const credits of [{}, { current_balance: null, currency: "USD" }, { current_balance: 2, currency: "EUR" }]) {
      upstream = { credits };
      assert.equal((await POST(usageRequest("fal", "credits"))).status, 502);
    }
    let page = 0;
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(++page === 1
        ? { summary: [{ cost_total: 1.5, currency: "USD" }], has_more: true, next_cursor: "page/2=" }
        : { summary: [{ cost_total: 2.5, currency: "USD" }], has_more: false, next_cursor: null });
    }) as typeof fetch;
    assert.deepEqual(await (await POST(usageRequest("fal"))).json(), { metrics: [{ label: "Key usage · This month", amount: 4 }] });
    assert.equal(page, 2);
    const usageUrl = new URL(calls.at(-1)!.url);
    assert.equal(usageUrl.origin, "https://api.fal.ai");
    assert.equal(usageUrl.searchParams.get("cursor"), "page/2=");
    assert.equal(usageUrl.searchParams.get("expand"), "summary");
    assert.equal(usageUrl.searchParams.get("api_key_id"), "test-key");
    assert.ok(calls.filter((call) => call.url.startsWith("https://api.fal.ai/v1/models/usage?")).every((call) => new URL(call.url).searchParams.get("api_key_id") === "test-key"));
    assert.ok(!usageUrl.href.includes("test-secret"));
    assert.match(usageUrl.searchParams.get("start")!, /-01T00:00:00.000Z$/);
    assert.equal(usageUrl.searchParams.get("bound_to_timeframe"), "false");
    for (const data of [
      { summary: [], has_more: false, next_cursor: null },
      { summary: [], has_more: true, next_cursor: "repeat" },
      { summary: [{ cost_total: "1", currency: "USD" }], has_more: false },
      { summary: [{ cost_total: 1, currency: "EUR" }], has_more: false },
      { summary: [], has_more: true }, {},
    ]) {
      globalThis.fetch = (async () => Response.json(data)) as typeof fetch;
      const response = await POST(usageRequest("fal"));
      assert.equal(response.status, data.has_more === false && data.summary?.length === 0 ? 200 : 502);
    }
    globalThis.fetch = (async () => new Response("secret", { status: 403 })) as typeof fetch;
    for (const action of ["usage", "credits"]) {
      const response = await POST(usageRequest("fal", action));
      assert.equal(response.status, 403);
      assert.match((await response.json()).message, /billing permissions/);
    }
    for (const status of [401, 402, 403, 429, 500]) {
      globalThis.fetch = (async () => new Response("secret upstream details test-key", { status })) as typeof fetch;
      const result = await POST(request({ provider: "fal", action: "verify" }));
      assert.equal(result.status, status === 500 ? 502 : status);
      assert.doesNotMatch(await result.text(), /secret|test-key/);
    }
    for (const response of [new Response("bad JSON"), Response.json({ error: { message: "secret" } })]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      assert.equal((await POST(request({ provider: "fal", action: "verify" }))).status, 502);
    }
    globalThis.fetch = (async () => { throw new Error("secret"); }) as typeof fetch;
    assert.equal((await POST(request({ provider: "fal", action: "verify" }))).status, 502);
    const controller = new AbortController();
    controller.abort();
    const aborted = request({ provider: "fal", action: "verify" });
    assert.equal((await POST(new Request(aborted, { signal: controller.signal }))).status, 504);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google requests use the Gemini endpoints, strip the model prefix and send the key as Google expects", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  const request = (body: unknown) => new Request("http://localhost/api/providers", { method: "POST", headers: { "x-api-key": "g-key", origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) });
  try {
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return String(url).includes("/models?pageSize=1000")
        ? Response.json({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] }] })
        : Response.json({ data: [{ b64_json: "AAAA" }] });
    }) as typeof fetch;
    assert.deepEqual(await (await POST(request({ provider: "google", action: "verify" }))).json(), { connected: true });
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
    assert.equal((calls[0].options?.headers as Record<string, string>)["x-goog-api-key"], "g-key");
    assert.deepEqual((await (await POST(request({ provider: "google", action: "models" }))).json()).models.filter((model: { category: string }) => model.category !== "video"), [{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", category: "llm" }]);

    assert.equal((await POST(request({ provider: "google", action: "image", model: "google/other", input: "a cat" }))).status, 400);
    assert.equal((await POST(request({ provider: "google", action: "video", model: "google-ai/gemini-2.5-flash", input: "a cat" }))).status, 400);
    assert.equal((await POST(request({ provider: "google", action: "video-status", model: "google-ai/veo-3.1:x", requestId: "abc" }))).status, 400);
    assert.equal((await POST(request({ provider: "google", action: "usage" }))).status, 400);
    calls.length = 0;
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      const target = String(url);
      if (target.endsWith(":predictLongRunning")) return Response.json({ name: "models/veo-3.1-generate-preview/operations/op1" });
      if (target.endsWith("/operations/op1")) return Response.json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media" } }] } } });
      if (target.includes("/files/f1")) return new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/signed" } });
      return new Response("video-bytes");
    }) as typeof fetch;
    assert.deepEqual(await (await POST(request({ provider: "google", action: "video", model: "google-ai/veo-3.1-generate-preview", input: "a cat" }))).json(), { id: "op1" });
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning");
    assert.equal((calls[0].options?.headers as Record<string, string>)["x-goog-api-key"], "g-key");
    assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { instances: [{ prompt: "a cat" }] });
    const veo = { provider: "google", model: "google-ai/veo-3.1-generate-preview", requestId: "op1" };
    assert.deepEqual(await (await POST(request({ ...veo, action: "video-status" }))).json(), { status: "completed" });
    assert.equal(await (await POST(request({ ...veo, action: "video-content" }))).text(), "video-bytes");
    assert.equal(calls.at(-1)?.url, "https://storage.googleapis.com/signed");
    assert.equal((calls.at(-1)?.options?.headers as Record<string, string> | undefined)?.["x-goog-api-key"], undefined);
    calls.length = 0;
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ data: [{ b64_json: "AAAA" }] });
    }) as typeof fetch;
    assert.equal((await POST(request({ provider: "google", action: "image", model: "google-ai/gemini-2.5-flash-image", input: "a cat" }))).status, 200);
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/images/generations");
    assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, "Bearer g-key");
    assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { model: "gemini-2.5-flash-image", prompt: "a cat", n: 1, response_format: "b64_json" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fal prices are looked up with the user's key, validated and shown as USD per unit", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  const request = (body: unknown) => new Request("http://localhost/api/providers", { method: "POST", headers: { "x-api-key": "id:secret", origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) });
  try {
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ prices: [
        { endpoint_id: "fal-ai/trellis", unit_price: 0.02, unit: "generation", currency: "USD" },
        { endpoint_id: "fal-ai/eur", unit_price: 1, unit: "image", currency: "EUR" },
        { endpoint_id: "fal-ai/bad", unit_price: "x", unit: "image", currency: "USD" },
        null,
      ], next_cursor: null, has_more: false });
    }) as typeof fetch;
    assert.deepEqual(await (await POST(request({ provider: "fal", action: "prices", input: ["fal-ai/trellis", "fal-ai/eur", "fal-ai/bad"] }))).json(), { prices: { "fal-ai/trellis": "$0.02/generation" } });
    assert.equal(calls[0].url, "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Ftrellis&endpoint_id=fal-ai%2Feur&endpoint_id=fal-ai%2Fbad");
    assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, "Key id:secret");
    for (const input of [undefined, [], ["../x"], ["fal-ai/ok&x=1"], Array(51).fill("fal-ai/x")]) {
      assert.equal((await POST(request({ provider: "fal", action: "prices", input }))).status, 400);
    }
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video requests send one first-frame picture, a duration and an aspect ratio to OpenRouter", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const post = (body: unknown) => POST(new Request("http://localhost/api/providers", {
    method: "POST", headers: { "x-api-key": "test-key", origin: "http://localhost", host: "localhost" }, body: JSON.stringify({ provider: "openrouter", action: "video", model: "google/veo-3.1", ...(body as object) }),
  }));
  try {
    globalThis.fetch = (async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(String(options?.body)) });
      return Response.json({ id: "job-1" });
    }) as typeof fetch;
    assert.equal((await post({ input: "a cat", images: [image], aspectRatio: "16:9", duration: 6 })).status, 200);
    assert.deepEqual(calls[0], { url: "https://openrouter.ai/api/v1/videos", body: {
      model: "google/veo-3.1", prompt: "a cat", aspect_ratio: "16:9", duration: 6,
      frame_images: [{ type: "image_url", image_url: { url: image }, frame_type: "first_frame" }],
    } });
    for (const body of [{ images: [image, image] }, { images: ["https://evil.test/a.png"] }, { duration: 0 }, { duration: 1.5 }, { aspectRatio: "7:3" }]) {
      assert.equal((await post({ input: "a cat", ...body })).status, 400);
    }
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
