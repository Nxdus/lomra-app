import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("provider proxy validates requests, isolates keys and hides upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  function request(body: unknown, key = "test-key", origin = "http://localhost") {
    return new Request("http://localhost/api/providers", {
      method: "POST", headers: { "x-api-key": key, origin }, body: JSON.stringify(body),
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
    assert.equal((await POST(new Request("http://localhost/api/providers", {
      method: "POST", headers: { "x-api-key": "test-key" }, body: "invalid",
    }))).status, 400);
    assert.equal(calls.length, 0);

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
