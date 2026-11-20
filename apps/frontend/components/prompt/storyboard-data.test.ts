import assert from "node:assert/strict";
import test from "node:test";
import { validateValue } from "@/lib/local-store/validation";
import { draftedShots, ensureShotIds, mergeStoryCharacters, moveShot, shotImagePrompt, shotTextLimits, storyReply, validStoryboard, type Storyboard } from "./storyboard-data";

const completion = (content: string) => ({ choices: [{ message: { content } }] });
const shot = { description: "Wide shot of a lighthouse", seconds: 4, image: null, references: [0] };

test("reads fenced story drafts and rejects an empty synopsis", () => {
  const json = JSON.stringify({ reply: "Add a storm?", story: "A keeper waits." });
  assert.deepEqual(storyReply(completion("```json\n" + json + "\n```")), { ...JSON.parse(json), characters: [] });
  assert.throws(() => storyReply(completion('{"reply":"Ready","story":" "}')));
  assert.deepEqual(storyReply(completion("Here you go:\n" + json + "\nDone.")), { ...JSON.parse(json), characters: [] });
});

test("keeps reviewed appearance, validates shot cast indices, and prioritizes continuity in a long image prompt", () => {
  const reply = storyReply(completion(JSON.stringify({
    story: "Mali keeps watch.", reply: "A lone guard.", characters: [{ name: "Mali", notes: "Red coat", image: 0, generatedId: "untrusted" }],
  })), 1);
  assert.deepEqual(reply.characters, [{ name: "Mali", notes: "Red coat", image: 0 }]);
  const cast = mergeStoryCharacters([{ name: "Mali", notes: "Blue coat", image: null }], reply.characters);
  assert.deepEqual(cast, [{ name: "Mali", notes: "Blue coat", image: 0 }]);
  const assigned = { ...shot, characters: [0] };
  assert.deepEqual(draftedShots(completion(JSON.stringify({ shots: [assigned] })), 1, cast), [assigned]);
  assert.throws(() => draftedShots(completion(JSON.stringify({ shots: [assigned] })), 1));
  assert.equal(validStoryboard({ story: "", characters: [{ ...cast[0], approved: true }], shots: [assigned] }, 1), false);
  const prompt = shotImagePrompt("Lantern", "A".repeat(9000), ["Mali: Blue coat (reference image 1)"]);
  assert.match(prompt, /Mali: Blue coat \(reference image 1\)/);
  assert.equal(prompt.length, 8000);
});

test("keeps ordered shots, validates references, and ignores model-supplied file IDs", () => {
  const first = { ...shot, image: 0, generatedId: "not-from-the-canvas", id: crypto.randomUUID() };
  assert.deepEqual(draftedShots(completion(JSON.stringify({ shots: [first, shot] })), 1), [{ ...shot, image: 0 }, shot]);
  for (const invalid of [{ ...shot, image: 1 }, { ...shot, references: [0, 0] }, { ...shot, seconds: 0 }]) {
    assert.throws(() => draftedShots(completion(JSON.stringify({ shots: [invalid] })), 1));
  }
  assert.equal(draftedShots(completion(JSON.stringify({ shots: [{ ...shot, references: [] }] })), 0).length, 1);
});

test("validates a saved storyboard alongside older chats", () => {
  const id = "my-chat";
  const chat = {
    id, title: "Story", updatedAt: 1, generations: [], models: [],
    history: [{ role: "user", content: "Tell a story", images: [{ name: "lighthouse", url: "data:image/jpeg;base64,AAAA" }] }],
  };
  assert.doesNotThrow(() => validateValue("chats", id, chat));
  assert.doesNotThrow(() => validateValue("chats", id, { ...chat, storyboard: { story: "Draft", shots: [{ ...shot, generatedId: "a-new-file" }] } }));
  assert.throws(() => validateValue("chats", id, { ...chat, storyboard: { story: "Draft", shots: [{ ...shot, generatedId: "../file" }] } }));
  assert.doesNotThrow(() => validateValue("chats", id, { ...chat, storyboard: { story: "Draft", shots: [{ ...shot, videoId: "a-new-clip" }] } }));
  assert.throws(() => validateValue("chats", id, { ...chat, storyboard: { story: "Draft", shots: [{ ...shot, videoId: "../clip" }] } }));
  assert.doesNotThrow(() => validateValue("chats", id, { ...chat, storyboard: { story: "Draft", videoItemId: "canvas-item-1" } }));
  assert.throws(() => validateValue("chats", id, { ...chat, storyboard: { story: "Draft", videoItemId: "../item" } }));
});

test("accepts finite shot positions only", () => {
  const at = (position: unknown) => validStoryboard({ story: "", shots: [{ ...shot, position }] }, 1);
  assert.equal(at({ x: -120.5, y: 40 }), true);
  assert.equal(at({ x: Infinity, y: 0 }), false);
  assert.equal(at({ x: 0 }), false);
});

test("assigns IDs to legacy shots once and validates optional shot details", () => {
  const identified = { ...shot, id: crypto.randomUUID(), scene: "Lighthouse", dialogue: "Come in", sound: "Wind", camera: "Pan" };
  const original = { story: "", shots: [shot, identified, shot] };
  assert.equal(validStoryboard(original, 1), true);
  const upgraded = ensureShotIds(original);
  assert.equal(validStoryboard(upgraded, 1), true);
  assert.equal(upgraded.shots?.[1], identified);
  assert.equal(ensureShotIds(upgraded), upgraded);
  assert.equal(new Set(upgraded.shots?.map(({ id }) => id)).size, 3);
  const withoutShots: Storyboard = { story: "" };
  assert.equal(ensureShotIds(withoutShots), withoutShots);
  assert.equal(validStoryboard({ story: "", shots: [identified, { ...shot, id: identified.id.toUpperCase() }] }, 1), false);
  assert.equal(validStoryboard({ story: "", shots: [{ ...shot, id: "../shot" }] }, 1), false);
  for (const [field, limit] of Object.entries(shotTextLimits)) {
    const withValue = (value: unknown) => validStoryboard({ story: "", shots: [{ ...shot, [field]: value }] }, 1);
    assert.equal(withValue("x".repeat(limit)), true);
    assert.equal(withValue("x".repeat(limit + 1)), false);
    assert.equal(withValue(null), false);
  }
});

test("moves whole shots to their final indices and preserves identity", () => {
  const first = { ...shot, id: crypto.randomUUID(), image: 0, position: { x: 50, y: 100 }, videoId: "clip" };
  const second = { ...shot, description: "Second" };
  const third = { ...shot, description: "Third" };
  const shots = [first, second, third];
  const moved = moveShot(shots, 0, 2);
  assert.deepEqual(moved, [second, third, first]);
  assert.equal(moved[2], first);
  assert.deepEqual(moveShot(moved, 2, 0), shots);
  assert.deepEqual(shots, [first, second, third]);
  for (const [from, to] of [[0, 0], [-1, 0], [0, 3], [0.5, 1], [1, NaN]]) {
    assert.equal(moveShot(shots, from, to), shots);
  }
});
