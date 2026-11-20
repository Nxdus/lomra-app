// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { expect, test } from "bun:test";
import { googleModels, googleTools } from "./google";

test("keeps usable Gemini chat and image models only", () => {
  const generate = ["generateContent"];
  expect(googleModels({ models: [
    { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: generate },
    { name: "models/gemini-2.5-flash-image", displayName: "Nano Banana", supportedGenerationMethods: generate },
    { name: "models/gemini-nano-banana-2.1", displayName: "Nano Banana 2.1", supportedGenerationMethods: generate },
    { name: "models/gemini-omni-1.2-flash", displayName: "Gemini Omni 1.2 Flash", supportedGenerationMethods: generate },
    { name: "models/gemini-3.5-transcribe", supportedGenerationMethods: generate },
    { name: "models/veo-3.1-generate-preview", displayName: "Veo 3.1", supportedGenerationMethods: ["predictLongRunning"] },
    { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: generate },
    { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
    { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
  ] })).toEqual([
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", category: "llm" },
    { id: "gemini-2.5-flash-image", name: "Nano Banana", category: "picture" },
    { id: "gemini-nano-banana-2.1", name: "Nano Banana 2.1", category: "picture" },
    { id: "gemini-omni-1.2-flash", name: "Gemini Omni 1.2 Flash", category: "video" },
    { id: "veo-3.1-generate-preview", name: "Veo 3.1", category: "video" },
  ]);
  expect(googleModels({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: generate }] }).map((model) => model.id))
    .toEqual(["gemini-2.5-flash", "veo-3.1-fast-generate-preview", "veo-3.1-generate-preview", "veo-3.1-lite-generate-preview"]);
  expect(googleModels(null)).toEqual([]);
});

test("removes schema keywords Gemini does not accept", () => {
  expect(googleTools([{ type: "object", additionalProperties: false, properties: { n: { type: "number", minimum: 0, exclusiveMinimum: 0, multipleOf: 0.5 }, k: { type: "integer", anyOf: [{ const: 0 }] } } }]))
    .toEqual([{ type: "object", properties: { n: { type: "number", minimum: 0 }, k: { type: "integer" } } }]);
});
