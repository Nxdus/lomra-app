import assert from "node:assert/strict";
import test from "node:test";
import { maxShotTakes, validStoryboard, type Shot } from "./storyboard-data";
import { generateShotTake, matchingShotTakeJob, normalizeShotTakes, selectedShotTake, selectShotTake, shotTakes, shotTakeSource } from "./storyboard-takes";

const shot: Shot = {
  id: "a4012d3c-8f29-40c1-968c-dde4693a1111",
  description: "Walk slowly", seconds: 4, image: 0, references: [], videoId: "legacy",
};
const model = "example/video";
const savedJob = { requestId: "known-job", source: shotTakeSource(shot), model, aspectRatio: "16:9" };

test("reads legacy clips and captures their source before editing", () => {
  assert.equal(selectedShotTake(shot)?.fileId, "legacy");
  assert.equal(selectedShotTake(shot)?.stale, false);
  const edited = { ...normalizeShotTakes(shot), camera: "Pan left", selectedTakeId: undefined, videoId: undefined };
  assert.equal(shotTakes(edited)[0].stale, true);
  assert.equal(shotTakes(edited)[0].selected, false);
  const selected = selectShotTake(edited, "legacy");
  assert.equal(selected.videoId, "legacy");
  assert.equal(selectedShotTake(selected)?.fileId, "legacy");
  assert.equal(selectedShotTake(selected)?.stale, true);
  assert.equal(validStoryboard({ story: "", shots: [selected] }, 1), true);
});

test("checks staleness by effective input and gives a generated frame precedence", () => {
  const generated = normalizeShotTakes({ ...shot, generatedId: "frame" });
  assert.equal(selectedShotTake({ ...generated, image: null, description: " Walk slowly " })?.stale, false);
  assert.equal(selectedShotTake({ ...generated, generatedId: undefined })?.stale, true);
  assert.equal(matchingShotTakeJob({ ...shot, pendingTake: savedJob, dialogue: "Hello" }, model), undefined);
});

test("resumes a saved job without submitting or loading the first frame", async () => {
  let current = { ...shot, pendingTake: savedJob } as Shot;
  const actions: string[] = [];
  await generateShotTake({
    shot: current, model, signal: new AbortController().signal,
    request: async (_provider, options) => {
      actions.push(options.action);
      assert.equal(options.requestId, savedJob.requestId);
      return { status: "completed", urls: ["https://example.com/clip.mp4"] };
    },
    loadPicture: async () => { throw new Error("Resume must not reload the picture"); },
    saveFile: async () => {
      assert.equal(selectedShotTake(current)?.fileId, "legacy");
      return "saved";
    },
    updateShot: (id, update) => {
      assert.equal(id, shot.id!);
      current = update(current);
    },
  });
  assert.deepEqual(actions, ["video-status"]);
  assert.deepEqual(shotTakes(current).map(({ fileId }) => fileId), ["legacy", "saved"]);
  assert.equal(current.videoId, "saved");
  assert.equal(current.pendingTake, undefined);
});

test("explicitly checks a job after the frame, prompt, model, and aspect ratio changed", async () => {
  const previous = { ...normalizeShotTakes(shot), image: null, description: "Run quickly", pendingTake: savedJob };
  let current: Shot = previous;
  const actions: string[] = [];
  const take = await generateShotTake({
    shot: current, model: "google-ai/unsupported-video", aspectRatio: "9:16", resume: true,
    signal: new AbortController().signal,
    request: async (provider, options) => {
      actions.push(options.action);
      assert.equal(provider, "openrouter");
      assert.equal(options.model, savedJob.model);
      assert.equal(options.requestId, savedJob.requestId);
      return { status: "completed", urls: ["https://example.com/clip.mp4"] };
    },
    loadPicture: async () => { throw new Error("Resume must not reload the picture"); },
    saveFile: async () => {
      assert.equal(current.pendingTake, savedJob);
      return "resumed-take";
    },
    updateShot: (_id, update) => { current = update(current); },
  });
  assert.deepEqual(actions, ["video-status"]);
  assert.deepEqual(take, { fileId: "resumed-take", model: savedJob.model, source: savedJob.source });
  assert.equal(current.pendingTake, undefined);
  assert.equal(selectedShotTake(current)?.stale, true);
  assert.equal(selectedShotTake(selectShotTake(current, "legacy"))?.fileId, "legacy");
});

test("blocks unmatched submissions and prevents explicit resume without a saved job", async () => {
  const previous: Shot = { ...shot, pendingTake: savedJob };
  const options: Parameters<typeof generateShotTake>[0] = {
    shot: previous, model, aspectRatio: "9:16", signal: new AbortController().signal,
    request: async () => { throw new Error("Unexpected provider request"); },
    loadPicture: async () => { throw new Error("Unexpected first frame"); },
    saveFile: async () => { throw new Error("Unexpected file"); },
    updateShot: () => { throw new Error("Unexpected shot update"); },
  };
  await assert.rejects(generateShotTake(options), /Check the saved job before generating another take/);
  assert.equal(previous.pendingTake, savedJob);
  await assert.rejects(generateShotTake({ ...options, shot, resume: true }), /There is no saved job to check/);
});

test("retains a received job after a storage failure and preserves existing takes", async () => {
  let current = shot;
  await assert.rejects(generateShotTake({
    shot: current, model, signal: new AbortController().signal,
    request: async (_provider, options) => options.action === "video"
      ? { id: savedJob.requestId }
      : { status: "completed", urls: ["https://example.com/clip.mp4"] },
    loadPicture: async () => "data:image/png;base64,AAAA",
    saveFile: async () => { throw new Error("Storage failed"); },
    updateShot: (_id, update) => { current = update(current); },
  }), /Check job to resume without another submission/);
  assert.deepEqual(matchingShotTakeJob(current, model), savedJob);
  assert.deepEqual(shotTakes(current).map(({ fileId }) => fileId), ["legacy"]);
});

test("distinguishes a lost submission response from a resumable job", async () => {
  let current = shot;
  await assert.rejects(generateShotTake({
    shot: current, model, signal: new AbortController().signal,
    request: async () => { throw new Error("Transport lost"); },
    loadPicture: async () => "data:image/png;base64,AAAA",
    saveFile: async () => { throw new Error("Unexpected file"); },
    updateShot: (_id, update) => { current = update(current); },
  }), /retrying starts a new generation/);
  assert.equal(current, shot);
});

test("clears a terminal job so a confirmed new submission is possible", async () => {
  let current: Shot = { ...shot, pendingTake: savedJob };
  await assert.rejects(generateShotTake({
    shot: current, model, signal: new AbortController().signal,
    request: async () => ({ status: "failed" }),
    loadPicture: async () => { throw new Error("Unexpected first frame"); },
    saveFile: async () => { throw new Error("Unexpected file"); },
    updateShot: (_id, update) => { current = update(current); },
  }), /^Error: Generation failed at the provider$/);
  assert.equal(current.pendingTake, undefined);
  assert.equal(selectedShotTake(current)?.fileId, "legacy");
});

test("keeps the latest take metadata up to the saved limit", async () => {
  let current: Shot = {
    ...shot, pendingTake: savedJob, videoId: "take-0", selectedTakeId: "take-0",
    takes: Array.from({ length: maxShotTakes }, (_, index) => ({ fileId: `take-${index}`, source: savedJob.source })),
  };
  await generateShotTake({
    shot: current, model, signal: new AbortController().signal,
    request: async () => ({ status: "completed", urls: ["https://example.com/clip.mp4"] }),
    loadPicture: async () => { throw new Error("Unexpected first frame"); },
    saveFile: async () => "saved",
    updateShot: (_id, update) => { current = update(current); },
  });
  assert.equal(current.takes?.length, maxShotTakes);
  assert.equal(current.takes?.[0].fileId, "take-1");
  assert.equal(current.videoId, "saved");
  assert.equal(validStoryboard({ story: "", shots: [current] }, 1), true);
});
