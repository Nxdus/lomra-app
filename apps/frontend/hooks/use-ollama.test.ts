import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ollamaStore, useOllama } from "./use-ollama";

test("a download keeps going without any screen and reports one steady progress for all its files", async () => {
  const originalFetch = globalThis.fetch;
  Object.assign(globalThis, { window: {} });
  const lines = [
    { status: "pulling manifest" },
    { status: "pulling aaa", digest: "aaa", total: 100, completed: 50 },
    // A second file appears: the total grows, but the bar must not move back.
    { status: "pulling bbb", digest: "bbb", total: 100, completed: 0 },
    { status: "pulling aaa", digest: "aaa", total: 100, completed: 100 },
    { status: "pulling bbb", digest: "bbb", total: 100, completed: 100 },
    { status: "verifying sha256 digest" },
    { status: "success" },
  ].map((line) => `${JSON.stringify(line)}\n`);
  try {
    globalThis.fetch = (async (_url, options) => {
      if (options?.method === "POST") return new Response(lines.join(""));
      return Response.json({ running: true, models: [], url: "http://127.0.0.1:11434", remote: false });
    }) as typeof fetch;
    const seen: (number | null)[] = [];
    const stop = ollamaStore.subscribe(() => { const pull = ollamaStore.snapshot().pull; if (pull) seen.push(pull.percent); });
    const first = ollamaStore.install("qwen3:4b");
    await assert.rejects(ollamaStore.install("other"), /Another download/);
    await first;
    stop();
    const numbers = seen.filter((value): value is number => value !== null);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
    assert.equal(numbers.at(-1), 100);
    assert.equal(ollamaStore.snapshot().pull, null);
    assert.equal(ollamaStore.snapshot().state?.running, true);

    // A stream that ends without "success" is reported, not treated as installed.
    globalThis.fetch = (async (_url, options) => options?.method === "POST"
      ? new Response('{"status":"pulling aaa","digest":"aaa","total":10,"completed":5}\n')
      : Response.json({ running: true, models: [], url: "http://127.0.0.1:11434", remote: false })) as typeof fetch;
    await assert.rejects(ollamaStore.install("qwen3:4b"), /interrupted/);
    assert.equal(ollamaStore.snapshot().pull, null);
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("Ollama models keep their identity across renders while the first status is pending", () => {
  let first: ReturnType<typeof useOllama>["models"] | undefined;
  function Probe() {
    const { models } = useOllama();
    if (first) assert.equal(models, first);
    first = models;
    return null;
  }
  renderToString(createElement(Probe));
  renderToString(createElement(Probe));
});
