import assert from "node:assert/strict";
import test from "node:test";
import { chatTimeline } from "./chat-timeline";
import type { ConversationMessage, Generation } from "./generation";

const task: Generation = { id: "one", category: "3d", model: "model", prompt: "hippo", status: "Completed", messageIndex: 1 };
const history: ConversationMessage[] = [
  { role: "user", content: "Make a hippo" },
  { role: "assistant", content: "" },
  { role: "assistant", content: "3d generated with model: hippo" },
  { role: "user", content: "Make another" },
  { role: "assistant", content: "Generating another" },
];

test("keeps multiple calls under their calling message across reloads and later turns", () => {
  const tasks = JSON.parse(JSON.stringify([task, { ...task, id: "two" }, { ...task, id: "three", messageIndex: 4 }])) as Generation[];
  assert.deepEqual(chatTimeline(history, tasks).map((group) => group.tasks.map((item) => item.id)),
    [[], ["one", "two"], [], [], ["three"]]);
});

test("matches legacy results to their summary and preserves unmatched jobs", () => {
  const groups = chatTimeline(history, [{ ...task, messageIndex: undefined }, { ...task, id: "unknown", prompt: "other", messageIndex: undefined }]);
  assert.equal(groups[2].tasks[0].id, "one");
  assert.equal(groups[5].message, undefined);
  assert.equal(groups[5].tasks[0].id, "unknown");
});
