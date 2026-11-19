import assert from "node:assert/strict";
import test from "node:test";
import { parseLibrary } from "../library";
import { GET } from "./route";

const badge = (kind: string, text: string) => `<span  class="inline-flex items-center rounded-md ${kind} px-2 py-0.5 text-xs font-medium text-blue-600 sm:text-[13px]">${text}</span>`;
const item = (name: string, capabilities: string[], sizes: string[]) => `
  <li  class="flex items-baseline border-b border-neutral-200 py-6">
    <a href="/library/${name}" class="group w-full space-y-5">
      <h2><span>${name}</span></h2>
      <div class="flex flex-wrap space-x-2">
        ${capabilities.map((text) => badge(text === "cloud" ? "bg-cyan-50" : "bg-indigo-50", text)).join("\n")}
        ${sizes.map((text) => badge("bg-[#ddf4ff]", text)).join("\n")}
      </div>
    </a>
  </li>`;

const page = `<ul>${[
  item("qwen3", ["tools", "thinking"], ["0.6b", "8b"]),
  item("nomic-embed-text", ["embedding"], []),
  item("gemma3", ["vision"], ["4b"]),
  item("gpt-oss", ["tools", "thinking", "cloud"], ["20b", "120b-cloud"]),
  item("granite3.3", ["tools"], []),
  item("qwen3", ["tools"], ["8b"]),
  `<li><a href="/library/../evil"><span class="inline-flex bg-indigo-50">tools</span></a></li>`,
].join("")}</ul>`;
const libraryRequest = new Request("http://localhost/api/ollama/library");

test("the library page gives tool-capable local models with their sizes", () => {
  // Embedding, vision-only and cloud models are left out; duplicates and odd names are dropped.
  assert.deepEqual(parseLibrary(page), ["qwen3", "qwen3:0.6b", "qwen3:8b", "granite3.3"]);
});

test("the library route returns the parsed list and hides upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(page)) as typeof fetch;
    assert.deepEqual(await (await GET(libraryRequest)).json(), { models: ["qwen3", "qwen3:0.6b", "qwen3:8b", "granite3.3"] });
    globalThis.fetch = (async () => new Response("<html>changed</html>")) as typeof fetch;
    assert.equal((await GET(libraryRequest)).status, 502);
    globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
    assert.equal((await GET(libraryRequest)).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the library route returns download sizes by tag and rejects invalid families", async () => {
  const originalFetch = globalThis.fetch;
  const tag = (name: string, size: string) => `<a href="/library/${name}" class="md:hidden flex"><span>digest</span> • ${size} • 128K context window</a>`;
  try {
    globalThis.fetch = (async (url) => {
      assert.equal(url, "https://ollama.com/library/llama3.1/tags");
      return new Response(`
        <meta name="description" content="Meta&#39;s Llama 3.1"/>
        ${tag("llama3.1:latest", "4.9GB")}
        ${tag("llama3.1:70b", "43GB")}
        ${tag("llama3.1:cloud", "Cloud")}
        ${tag("other:latest", "1GB")}
      `);
    }) as typeof fetch;
    const result = await GET(new Request(`${libraryRequest.url}?family=llama3.1`));
    assert.deepEqual(await result.json(), {
      description: "Meta's Llama 3.1",
      sizes: { "llama3.1:latest": "4.9 GB", "llama3.1:70b": "43 GB" },
    });
    assert.equal((await GET(new Request(`${libraryRequest.url}?family=..%2Fprivate`))).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
