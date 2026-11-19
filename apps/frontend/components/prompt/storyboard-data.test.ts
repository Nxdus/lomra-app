import assert from "node:assert/strict";
import test from "node:test";
import { validateValue } from "@/lib/local-store/validation";
import { draftedShots, mergeStoryCharacters, shotImagePrompt, storyReply, validStoryboard } from "./storyboard-data";

const completion = (content: string) => ({ choices: [{ message: { content } }] });
const shot = { description: "Wide shot of a lighthouse", seconds: 4, image: null, references: [0] };

test("reads fenced story drafts and rejects an empty synopsis", () => {
  const json = JSON.stringify({ reply: "Add a storm?", story: "A keeper waits." });
  assert.deepEqual(storyReply(completion("```json\n" + json + "\n```")), { ...JSON.parse(json), characters: [] });
  assert.throws(() => storyReply(completion('{"reply":"Ready","story":" "}')));
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
  const first = { ...shot, image: 0, generatedId: "not-from-the-canvas" };
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
});
