// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import { mentionedCharacters, type Character } from "@/lib/characters";
import { characterGeneration } from "./character-references";
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
});

test("Gemini Browser video uses the chosen scene frame or one saved portrait", () => {
  const video = { ...picture, category: "video" as const, model: geminiVideoModel };
  expect(characterGeneration(video, ["scene"], [reference]).images).toEqual(["scene"]);
  expect(characterGeneration(video, [], [reference]).images).toEqual(["portrait"]);
  expect(() => characterGeneration(video, ["scene", "other"], [reference])).toThrow("first frame");
  expect(() => characterGeneration({ ...video, model: "example/video" }, [], [reference])).toThrow("Choose Gemini Browser video");
});
