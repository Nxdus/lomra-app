import assert from "node:assert/strict";
import test from "node:test";
import { validStoryboard, type Storyboard } from "./storyboard-data";
import { defaultTimeline, resolveStoryboardTimeline, storyboardTimelineRenderInput } from "./storyboard-timeline-data";

const shot = { description: "A room", image: null, references: [], seconds: 4 };
const board: Storyboard = {
  story: "A story",
  shots: [
    { ...shot, videoId: "legacy" },
    { ...shot, selectedTakeId: "new", takes: [{ fileId: "new", source: { frame: null, prompt: "" } }] },
  ],
};

test("legacy storyboards still validate and timeline edits use workspace IDs", () => {
  assert.equal(validStoryboard(board, 0), true);
  assert.equal(validStoryboard({ ...board, timeline: defaultTimeline }, 0), true);
  const audio = { fileId: "voice", name: "voice.wav", kind: "narration", start: 0, seconds: 5, gain: 2 };
  assert.equal(validStoryboard({ ...board, timeline: { ...defaultTimeline, audio: [audio] } }, 0), true);
  assert.equal(validStoryboard({ ...board, timeline: { ...defaultTimeline, audio: [{ ...audio, fileId: "../voice" }] } }, 0), false);
  assert.equal(validStoryboard({ ...board, timeline: { ...defaultTimeline, audio: [{ ...audio, gain: 2.1 }] } }, 0), false);
  assert.equal(validStoryboard({ ...board, timeline: {
    ...defaultTimeline, audio: Array.from({ length: 9 }, (_, i) => ({ ...audio, fileId: `audio-${i}` })),
  } }, 0), false);
});

test("timeline uses shot order and edits only the selected take", async () => {
  const plan = resolveStoryboardTimeline(board, {
    aspectRatio: "9:16",
    trims: [
      { fileId: "unselected", start: 1, end: 3, mute: true },
      { fileId: "new", start: 0.1, end: 1.1, mute: true },
    ],
    audio: [{ fileId: "voice", name: "voice.wav", kind: "narration", start: 2, seconds: 3, gain: 0.5 }],
    captions: [{ start: 2, end: 5, text: " Second " }, { start: 0, end: 2, text: "First" }],
  });
  assert.deepEqual(plan.clips, [
    { fileId: "legacy", start: 0, seconds: 4, mute: false },
    { fileId: "new", start: 0.1, seconds: 1, mute: true },
  ]);
  assert.deepEqual(plan.captions.map(({ text }) => text), ["First", "Second"]);
  const requested: string[] = [];
  const input = await storyboardTimelineRenderInput(plan, async (id) => {
    requested.push(id);
    return new Blob([new Uint8Array([1])]);
  });
  assert.deepEqual(requested, ["legacy", "new", "voice"]);
  assert.equal(input.aspectRatio, "9:16");
  assert.deepEqual(input.audio, [{ start: 2, gain: 0.5, data: new Uint8Array([1]) }]);
  await assert.rejects(storyboardTimelineRenderInput(plan, async (id) =>
    id === "voice" ? undefined : new Blob(["video"]),
  ), /Audio track 1 is missing or unreadable/);
  await assert.rejects(storyboardTimelineRenderInput(plan, async () => { throw new Error("HTTP 404"); }), /Shot 1 video is missing or unreadable/);
});

test("timeline blocks invalid edits and timing beyond the trimmed video", () => {
  const caption = { start: 1, end: 6, text: "Hello" };
  const trims = [{ fileId: "new", start: 2, end: 3, mute: false }];
  assert.throws(() => resolveStoryboardTimeline(board, { ...defaultTimeline, trims, captions: [caption] }), /subtitle extends/);
  assert.throws(() => resolveStoryboardTimeline(board, {
    ...defaultTimeline, trims, audio: [{ fileId: "voice", name: "voice.wav", kind: "music", start: 4, seconds: 2, gain: 1 }],
  }), /audio track extends/);
  const overlap = { ...defaultTimeline, captions: [caption, { start: 5, end: 7, text: "Overlap" }] };
  assert.equal(validStoryboard({ ...board, timeline: overlap }, 0), false);
  assert.throws(() => resolveStoryboardTimeline(board, overlap), /overlap/);
  assert.throws(() => resolveStoryboardTimeline(board, { ...defaultTimeline, trims: [{ ...trims[0], start: -1 }] }), /trim ranges/);
  assert.throws(() => resolveStoryboardTimeline({ ...board, shots: [shot] }), /Select a video take for shot 1/);
});
