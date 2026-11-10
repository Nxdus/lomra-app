import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

test("model catalog shows only curated top and economy choices with valid outputs", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const request = (category: string) => new Request(`http://localhost/api/models?category=${category}`);
  try {
    globalThis.fetch = (async (url) => {
      urls.push(String(url));
      return Response.json({ data: [
        { id: "test/vision", name: "Vision", architecture: { input_modalities: ["image"], output_modalities: ["text"] } },
        { id: "google/gemini-3.1-flash-lite", name: "Flash Lite", architecture: { output_modalities: ["text"] } },
        { id: "anthropic/claude-opus-5.5", name: "Opus", architecture: { output_modalities: ["text"] } },
        { id: "google/gemini-3.1-flash-lite-image", name: "Image Lite", architecture: { output_modalities: ["text", "image"] } },
        { id: "openai/gpt-5.4-image-2", name: "Image", architecture: { output_modalities: ["text", "image"] } },
        { id: "google/veo-3.1", name: "Video" },
        { id: "google/veo-3.1-lite", name: "Video Lite" },
        { id: "test/image", name: "Other Image", architecture: { output_modalities: ["image"] } },
        null, { id: "invalid" },
      ] });
    }) as typeof fetch;
    assert.deepEqual((await (await GET(request("picture"))).json()).models, [
      { id: "openai/gpt-5.4-image-2", name: "Image", tier: "Top Tier" },
      { id: "google/gemini-3.1-flash-lite-image", name: "Image Lite", tier: "Economy" },
    ]);
    assert.deepEqual((await (await GET(request("llm"))).json()).models, [
      { id: "anthropic/claude-opus-5.5", name: "Opus", tier: "Top Tier" },
      { id: "google/gemini-3.1-flash-lite", name: "Flash Lite", tier: "Economy" },
    ]);
    assert.equal(urls.at(-1), "https://openrouter.ai/api/v1/models");
    assert.deepEqual((await (await GET(request("video"))).json()).models, [
      { id: "google/veo-3.1", name: "Video", tier: "Top Tier" },
      { id: "google/veo-3.1-lite", name: "Video Lite", tier: "Economy" },
    ]);
    assert.equal(urls.at(-1), "https://openrouter.ai/api/v1/videos/models");
    const fullCatalog = async (category: string) => (await (await GET(new Request(`http://localhost/api/models?category=${category}&all=true`))).json()).models;
    assert.ok((await fullCatalog("llm")).some((model: { id: string }) => model.id === "test/vision"));
    assert.ok(!(await fullCatalog("llm")).some((model: { id: string }) => model.id === "test/image"));
    assert.ok((await fullCatalog("picture")).some((model: { id: string }) => model.id === "test/image"));
    assert.ok(!(await fullCatalog("picture")).some((model: { id: string }) => model.id === "test/vision"));
    const count = urls.length;
    const models = (await (await GET(request("3d"))).json()).models;
    assert.equal(models.length, 6);
    assert.deepEqual(models.map((model: { capabilities: string[] }) => model.capabilities), [["text-to-3d"], ["text-to-3d"], ["image-to-3d"], ["multi-view-to-3d"], ["multi-view-to-3d"], ["image-to-3d"]]);
    assert.deepEqual(models.slice(0, 2).map((m: { tier: string }) => m.tier), ["Top Tier", "Economy"]);
    assert.ok(models.every((m: { id: string }) => (m.id.startsWith("fal-ai/") || m.id.startsWith("hitem3d/"))));
    assert.equal((await GET(request("unknown"))).status, 400);
    assert.equal(urls.length, count);
    globalThis.fetch = (async (url) => {
      const capability = new URL(String(url)).searchParams.get("category");
      assert.ok(capability === "text-to-3d" || capability === "image-to-3d");
      if (capability === "image-to-3d") return Response.json({ models: [
        { endpoint_id: "test/image-3d", metadata: { display_name: "Image 3D", category: capability, status: "active" } },
        { endpoint_id: "meshy/v7.1/multi-image-to-3d", metadata: { display_name: "Meshy 7.1", category: capability, status: "active" } },
        { endpoint_id: "hitem3d/hi3d/multi-view-to-3d", metadata: { display_name: "Hi3D", category: capability, status: "active" } },
        { endpoint_id: "test/old-image", metadata: { display_name: "Old image", category: capability, status: "deprecated" } },
      ] });
      return Response.json({ models: [
        { endpoint_id: "test/3d", metadata: { display_name: "Test 3D", category: "text-to-3d", status: "active" } },
        { endpoint_id: "test/image", metadata: { display_name: "Wrong category", category: "text-to-image", status: "active" } },
        { endpoint_id: "test/old", metadata: { display_name: "Deprecated", category: "text-to-3d", status: "deprecated" } },
        null, { endpoint_id: "invalid" },
      ] });
    }) as typeof fetch;
    assert.deepEqual(await fullCatalog("3d"), [
      { id: "test/3d", name: "Test 3D", capabilities: ["text-to-3d"] },
      { id: "test/image-3d", name: "Image 3D", capabilities: ["image-to-3d"] },
      { id: "meshy/v7.1/multi-image-to-3d", name: "Meshy 7.1", capabilities: ["multi-view-to-3d"] },
      { id: "hitem3d/hi3d/multi-view-to-3d", name: "Hi3D", capabilities: ["multi-view-to-3d"] },
    ]);
    globalThis.fetch = (async () => Response.json({ data: [
      { id: "anthropic/claude-opus-5.5", name: "Wrong output", architecture: { output_modalities: ["image"] } },
    ] })) as typeof fetch;
    assert.deepEqual((await (await GET(request("llm"))).json()).models, []);
    for (const response of [new Response("secret", { status: 503 }), Response.json({ data: {} }), new Response("bad json")]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      const result = await GET(request("llm"));
      assert.equal(result.status, 502);
      assert.doesNotMatch(await result.text(), /secret/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
