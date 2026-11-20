import assert from "node:assert/strict";
import test from "node:test";
import type { Storyboard } from "./storyboard-data";
import {
  applyReviewProposal, parseReview, planReview, reviewImages, reviewReferences, reviewShots,
  type ReviewProposal,
} from "./storyboard-review-data";
import { defaultTimeline } from "./storyboard-timeline-data";

const before = "00000000-0000-4000-8000-000000000001";
const middle = "00000000-0000-4000-8000-000000000002";
const after = "00000000-0000-4000-8000-000000000003";
const draft = "00000000-0000-4000-8000-000000000004";
const picture = "data:image/jpeg;base64,AA==";
const shot = { description: "A room", image: null, references: [], seconds: 4 };
const board: Storyboard = {
  story: "A story",
  shots: [
    { ...shot, id: before, image: 0, references: [1], characters: [0, 1] },
    { ...shot, id: middle, videoId: "clip", selectedTakeId: "clip", takes: [{ fileId: "clip", source: { frame: null, prompt: "" } }] },
    { ...shot, id: after, generatedId: "closing-picture" },
  ],
  characters: [
    { name: "Maya", image: null, notes: "", generatedId: "maya", approved: true },
    { name: "Lee", image: null, notes: "", generatedId: "lee", approved: false },
  ],
  timeline: { ...defaultTimeline, trims: [{ fileId: "clip", start: 2, end: 6, mute: true }] },
};
const images = [{ name: "First shot", url: picture }, { name: "Prop", url: picture }];
const completion = (observations: unknown[], proposals: unknown[]) => ({
  choices: [{ message: { content: JSON.stringify({ observations, proposals }) } }],
});

test("samples the active take inside its trim and restores full timeline offsets", async () => {
  const shots = reviewShots(board, images);
  const plan = planReview(shots.slice(1), []);
  assert.deepEqual(plan[0].samples, [{ source: 3, timeline: 5 }, { source: 4, timeline: 6 }, { source: 5, timeline: 7 }]);
  assert.deepEqual(plan[1].samples, [{ source: 0, timeline: 8 }]);
  const attachments = await reviewImages(plan, [], new AbortController().signal, async ({ samples }) => samples.map(() => picture));
  assert.deepEqual(attachments.map(({ name }) => name), [
    `Shot 2 [${middle}] frame at timeline 5s`,
    `Shot 2 [${middle}] frame at timeline 6s`,
    `Shot 2 [${middle}] frame at timeline 7s`,
    `Shot 3 [${after}] still at timeline 8s`,
  ]);
});

test("includes only relevant, approved references within the image limit", async () => {
  const references = reviewReferences(board, images, new Set([before]));
  assert.deepEqual(references.map(({ name }) => name), ["Prop", "Maya"]);
  assert.deepEqual(reviewReferences(board, images, new Set([middle])), []);
  const shots = reviewShots(board, images);
  const repeated = Array.from({ length: 7 }, (_, index) => ({ ...shots[1], id: String(index) }));
  const plan = planReview(repeated, references);
  const attachments = await reviewImages(plan, references, new AbortController().signal,
    async ({ samples }) => samples.map(() => picture), async () => picture);
  assert.equal(attachments.length, 10);
  assert.equal(attachments.at(-1)?.name, "Reference: Maya");
  assert.throws(() => planReview([...repeated, ...shots], references), /10-image limit/);
});

test("missing samples and references fail before sending images", async () => {
  const shots = reviewShots(board, images);
  const plan = planReview([shots[1]], []);
  const signal = new AbortController().signal;
  await assert.rejects(reviewImages(plan, [], signal, async () => [picture]), /shot 2.*incomplete images/i);
  const references = reviewReferences(board, images, new Set([before]));
  await assert.rejects(reviewImages(plan, references, signal, async ({ samples }) => samples.map(() => picture),
    async () => { throw new Error("missing"); }), /Could not load reference.*Prop/);
});

const trim: ReviewProposal = { kind: "trim", shotId: middle, start: 3, end: 6, reason: "Cut the pause" };
const bridge: ReviewProposal = {
  kind: "bridge", afterShotId: middle, beforeShotId: after, seconds: 2, description: "A hand opens the door.", reason: "Connect the rooms",
};

test("filters unknown IDs, unsampled times, invalid trims, and nonadjacent bridges", () => {
  const plan = planReview(reviewShots(board, images), []);
  const observation = { shotId: middle, time: 5, text: "The figure pauses." };
  const result = parseReview(completion(
    [observation, { ...observation, time: 3 }, { ...observation, shotId: "invented" }],
    [trim, bridge, { ...trim, start: 1 }, { ...trim, end: 7 }, { ...trim, end: 3.5 }, { ...trim, start: 4.1 },
      { ...trim, shotId: before }, { ...bridge, afterShotId: before }, { ...bridge, description: " " }, { ...bridge, seconds: 6 }],
  ), plan);
  assert.deepEqual(result, { observations: [observation], proposals: [trim, bridge], discarded: 10 });
  assert.throws(() => parseReview(completion([], Array(11).fill(trim)), plan), /valid storyboard review/);
});

test("applies only the confirmed edit and rechecks the board and timeline limits", () => {
  const trimmed = applyReviewProposal(board, trim, images.length, draft);
  assert.deepEqual(trimmed.timeline?.trims, [{ fileId: "clip", start: 3, end: 6, mute: true }]);
  assert.equal(trimmed.shots, board.shots);
  assert.throws(() => applyReviewProposal(trimmed, trim, images.length, draft), /no longer matches/);
  const bridged = applyReviewProposal(board, bridge, images.length, draft);
  assert.deepEqual(bridged.shots?.map(({ id }) => id), [before, middle, draft, after]);
  assert.deepEqual(bridged.shots?.[2], { ...shot, id: draft, description: bridge.description, seconds: 2 });
  assert.equal(bridged.timeline, board.timeline);
  assert.throws(() => applyReviewProposal(bridged, bridge, images.length, draft), /no longer matches/);
  const captioned = { ...board, timeline: { ...board.timeline!, captions: [{ start: 10, end: 12, text: "End" }] } };
  assert.throws(() => applyReviewProposal(captioned, trim, images.length, draft), /subtitle extends/);
});
