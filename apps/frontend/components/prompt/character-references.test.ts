// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import { mentionedCharacters, type Character } from "@/lib/characters";
import { characterGeneration, loadCharacterReferences } from "./character-references";
import { browserImageModel, geminiVideoModel, type Generation } from "./generation";

const rain: Character = { id: "rain", name: "น้องฝน", notes: "Notch in the left ear", imageType: "image/png" };
const scout: Character = { ...rain, id: "scout", name: "Café-Scout", notes: "" };
const reference = { character: rain, url: "portrait" };
const picture: Generation = { id: "task", category: "picture", model: browserImageModel, prompt: "Draw a café scene.", status: "Waiting" };

test("mentions match Thai combining marks and normalized names without matching emails or longer handles", () => {
  expect(mentionedCharacters("mail@น้องฝน.net @น้องฝน-2 (@น้องฝน), @CAFE\u0301-SCOUT @น้องฝน", [scout, rain])).toEqual([rain, scout]);
  expect(() => mentionedCharacters("@น้องฝน", [rain, { ...rain, id: "other" }])).toThrow("more than one Character");
});

test("image references retain selected image order and label a duplicate only once", () => {
  const first = characterGeneration(picture, ["scene"], [reference]);
  expect(first.images).toEqual(["scene", "portrait"]);
  expect(first.task.prompt).toContain("Image 2 is @น้องฝน.");
  expect(first.task.prompt).toContain(rain.notes);
  expect(characterGeneration(picture, ["portrait"], [reference]).images).toEqual(["portrait"]);
  expect(() => characterGeneration({ ...picture, model: "sd/example" }, [], [reference])).toThrow("cannot use Character references");
  expect(() => characterGeneration({ ...picture, model: "google-ai/imagen-3" }, [], [reference])).toThrow("cannot use Character references");
  const sdWithRefs = {
    supported: true, engine: true, engineBytes: 0, gpuBytes: 0, downloading: null, queued: [], error: null, profiles: [],
    models: [{
      id: "with-refs", name: "With Refs", quality: "", note: "", bytes: 1, recommended: false, installed: true, partial: 0, custom: true, inpaint: false,
      profile: {
        id: "with-refs", name: "With Refs", note: "", size: 512, steps: 4, cfg: 1, strength: 0.75,
        ranges: { steps: { min: 1, max: 12, whole: true }, cfg: { min: 1, max: 1, whole: false }, strength: { min: 0, max: 1, whole: false } },
        capabilities: { textToImage: true, imageToImage: true, inpaint: true, negativePrompt: false, cfg: false, strength: true, outpaint: false, referencePictures: true },
      },
    }],
  };
  expect(characterGeneration({ ...picture, model: "sd/with-refs" }, [], [reference], sdWithRefs).images).toEqual(["portrait"]);
});

test("Gemini Browser video uses the chosen scene frame or one saved portrait", () => {
  const video = { ...picture, category: "video" as const, model: geminiVideoModel };
  expect(characterGeneration(video, ["scene"], [reference]).images).toEqual(["scene"]);
  expect(characterGeneration(video, [], [reference]).images).toEqual(["portrait"]);
  expect(() => characterGeneration(video, ["scene", "other"], [reference])).toThrow("first frame");
  expect(() => characterGeneration({ ...video, model: "example/video" }, [], [reference])).toThrow("Choose Gemini Browser video");
});

test("a saved Character loads all views for pictures and uses its cover for video", async () => {
  const character = { ...rain, additionalImageTypes: ["image/jpeg"], coverIndex: 1 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (url === "/api/storage/characters") return Response.json([{ value: character }, { value: scout }]);
    return new Response(String(url).split("/").at(-1));
  }) as typeof fetch;
  try {
    const references = await loadCharacterReferences("@น้องฝน @Café-Scout", new AbortController().signal);
    const cover = `data:image/jpeg;base64,${btoa("rain-1")}`;
    const first = `data:image/png;base64,${btoa("rain")}`;
    expect(references.map(({ url }) => url)).toEqual([cover, `data:image/png;base64,${btoa("scout")}`]);
    const result = characterGeneration(picture, [], [references[0]]);
    expect(result.images).toEqual([cover, first]);
    expect(result.task.prompt).toContain("Image 2 is @น้องฝน.");
    expect(result.task.prompt.match(/Notch in the left ear/g)).toHaveLength(1);
    expect(characterGeneration({ ...picture, category: "video", model: geminiVideoModel }, [], [references[0]]).images).toEqual([cover]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
