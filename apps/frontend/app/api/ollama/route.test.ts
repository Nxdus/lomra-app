import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "./route";
import { POST as providers } from "../providers/route";

test("Ollama routes list models, stream installs and proxy chat without a key", async () => {
  const originalFetch = globalThis.fetch;
  const originalDir = process.env.LOMRA_DATA_DIR;
  const dir = process.env.LOMRA_DATA_DIR = await mkdtemp(join(tmpdir(), "lomra-ollama-"));
  const calls: { url: string; body?: unknown }[] = [];
  try {
    globalThis.fetch = (async (url, options) => {
      const path = new URL(String(url)).pathname;
      calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : undefined });
      if (path === "/api/tags") return Response.json({ models: [{ name: "qwen3:4b", size: 2_500_000_000 }, { name: "nomic-embed-text", size: 1 }, { name: "../bad", size: 1 }] });
      if (path === "/api/show") {
        const model = (JSON.parse(String(options?.body)) as { model: string }).model;
        return Response.json({ capabilities: model === "qwen3:4b" ? ["completion", "tools", "vision"] : ["embedding"] });
      }
      if (path === "/api/pull") return new Response('{"status":"pulling"}\n{"status":"success"}\n');
      if (path === "/v1/chat/completions") return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      return Response.json({});
    }) as typeof fetch;

    const listed = await (await GET()).json();
    assert.deepEqual(listed, { url: "http://127.0.0.1:11434", remote: false, running: true, models: [{ id: "qwen3:4b", size: 2_500_000_000, tools: true, vision: true }] });

    const post = (body: unknown, origin = "http://localhost") => POST(new Request("http://localhost/api/ollama", { method: "POST", headers: { origin, host: "localhost" }, body: JSON.stringify(body) }));
    assert.equal((await post({ action: "pull", model: "qwen3:4b" }, "https://evil.test")).status, 403);
    for (const body of [{}, { action: "pull" }, { action: "pull", model: "../x" }, { action: "run", model: "a" }, { action: "pull", model: "a b" }]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.match(await (await post({ action: "pull", model: "qwen3:4b" })).text(), /success/);

    const chat = (body: unknown) => providers(new Request("http://localhost/api/providers", { method: "POST", headers: { origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) }));
    const input = [{ role: "user", content: "Hello" }];
    for (const body of [{ provider: "ollama", action: "verify" }, { provider: "ollama", action: "chat", model: "openai/x", input }, { provider: "ollama", action: "chat", model: "ollama/../x", input }]) {
      assert.equal((await chat(body)).status, 400);
    }
    const before = calls.length;
    const reply = await chat({ provider: "ollama", action: "chat", model: "ollama/qwen3:4b", input });
    assert.equal(reply.status, 200);
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1)?.url, "http://127.0.0.1:11434/v1/chat/completions");
    assert.deepEqual(calls.at(-1)?.body, { model: "qwen3:4b", messages: input, stream: true });
    await chat({ provider: "ollama", action: "route", model: "ollama/qwen3:4b", input });
    const routed = calls.at(-1)?.body as { tools?: unknown[]; tool_choice?: string; provider?: unknown };
    assert.equal(routed.tool_choice, "auto");
    assert.ok(routed.tools?.length);
    assert.equal(routed.provider, undefined);

    // A server on another computer, saved in Settings, is used for both listing and chat.
    await mkdir(join(dir, "settings"), { recursive: true });
    await writeFile(join(dir, "settings", "ollama-url.json"), JSON.stringify("http://192.168.1.20:11434"));
    await GET();
    assert.equal(calls.at(-1)?.url.startsWith("http://192.168.1.20:11434/api/"), true);
    assert.equal((await GET().then((response) => response.json())).remote, true);
    await chat({ provider: "ollama", action: "chat", model: "ollama/qwen3:4b", input });
    assert.equal(calls.at(-1)?.url, "http://192.168.1.20:11434/v1/chat/completions");
    await writeFile(join(dir, "settings", "ollama-url.json"), JSON.stringify("http://127.0.0.1:11434"));

    globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    assert.deepEqual(await (await GET()).json(), { url: "http://127.0.0.1:11434", remote: false, running: false, models: [] });
    const offline = await chat({ provider: "ollama", action: "chat", model: "ollama/qwen3:4b", input });
    assert.equal(offline.status, 502);
    assert.match((await offline.json()).message, /Cannot reach Ollama/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDir === undefined) delete process.env.LOMRA_DATA_DIR; else process.env.LOMRA_DATA_DIR = originalDir;
  }
});
