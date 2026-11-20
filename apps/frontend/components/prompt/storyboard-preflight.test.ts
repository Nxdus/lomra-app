import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopVideoApi } from "@/lib/desktop";
import type { Shot, Storyboard } from "./storyboard-data";
import { preflightStoryboardVideo } from "./storyboard-preflight";
import { shotTakeSource } from "./storyboard-takes";

const supportedVideoBridge: DesktopVideoApi = {
  status: async () => ({ supported: true, installed: true, bytes: 0, downloading: null, error: null }),
  download: async () => true,
  cancelDownload: async () => {},
  remove: async () => true,
  stitch: async () => ({ video: new Uint8Array([1, 2, 3]) }),
  cancel: () => {},
  onProgress: () => () => {},
};

const validShot: Shot = {
  id: "00000000-0000-4000-8000-000000000001",
  description: "A wide establishing shot of a quiet town",
  seconds: 4,
  image: null,
  references: [],
};

const openrouterModel = "openrouter/openai/sora-2";
const openrouterPictureModel = "openrouter/black-forest-labs/flux-1-schnell";
const keys = { openrouter: "sk-or-valid", google: "google-key", fal: "fal-key" };

test("preflight succeeds when all shots have finished takes and verifies media", async () => {
  const board: Storyboard = {
    story: "Test story",
    shots: [
      {
        ...validShot,
        selectedTakeId: "take-1",
        takes: [{ fileId: "take-1", source: { frame: null, prompt: "" } }],
      },
    ],
  };

  const result = await preflightStoryboardVideo({
    story: board,
    videoModel: "",
    desktopVideo: supportedVideoBridge,
    storageFile: async (id) => (id === "take-1" ? new Blob(["video data"]) : undefined),
  });

  assert.equal(result.ok, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.clips, 0);
  assert.equal(result.resumes, 0);
  assert.equal(result.pictures, 0);
});

test("regression: valid first shot preceding invalid later shot is blocked up front", async () => {
  const board: Storyboard = {
    story: "Two-shot story",
    shots: [
      {
        ...validShot,
        description: "Valid first shot with description",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        description: "   ", // neither image nor description
        seconds: 4,
        image: null,
        references: [],
      },
    ],
  };

  const result = await preflightStoryboardVideo({
    story: board,
    videoModel: openrouterModel,
    pictureModel: openrouterPictureModel,
    keys,
    desktopVideo: supportedVideoBridge,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockers.some((b) => b.message.includes("Shot 2 needs an image or a description")), true);
  assert.equal(result.blockers.some((b) => b.shotIndex === 1), true);
});

test("preflight blocks missing or incompatible video models", async () => {
  const board: Storyboard = {
    story: "Test story",
    shots: [validShot],
  };

  // Missing video model
  const missingModel = await preflightStoryboardVideo({
    story: board,
    videoModel: "",
    desktopVideo: supportedVideoBridge,
  });
  assert.equal(missingModel.ok, false);
  assert.equal(missingModel.blockers[0].message, "Select a video model in the prompt toolbar first.");

  // Incompatible video model (Google Veo cannot start from a picture)
  const incompatible = await preflightStoryboardVideo({
    story: board,
    videoModel: "google-ai/veo-2.0-generate-preview",
    desktopVideo: supportedVideoBridge,
  });
  assert.equal(incompatible.ok, false);
  assert.equal(
    incompatible.blockers[0].message,
    "This video model cannot start from a picture. Choose Gemini Omni, Gemini Create video or an OpenRouter video model.",
  );
});

test("preflight blocks missing API keys for video and picture generation", async () => {
  const board: Storyboard = {
    story: "Test story",
    shots: [validShot],
  };

  // Missing video API key
  const noVideoKey = await preflightStoryboardVideo({
    story: board,
    videoModel: openrouterModel,
    pictureModel: openrouterPictureModel,
    keys: { openrouter: "", google: "" },
    desktopVideo: supportedVideoBridge,
  });
  assert.equal(noVideoKey.ok, false);
  assert.equal(
    noVideoKey.blockers.some((b) => b.message === "Enter your OpenRouter API key in Settings to generate video clips."),
    true,
  );

  // Missing picture API key when image drawing is needed
  const noOpenRouterPicKey = await preflightStoryboardVideo({
    story: board,
    videoModel: openrouterModel,
    pictureModel: openrouterPictureModel,
    keys: { openrouter: "", google: "google-key" },
    desktopVideo: supportedVideoBridge,
  });
  assert.equal(noOpenRouterPicKey.ok, false);
  assert.equal(
    noOpenRouterPicKey.blockers.some((b) => b.message === "Enter your OpenRouter API key in Settings to generate shot images."),
    true,
  );

  const googlePic = await preflightStoryboardVideo({
    story: board,
    videoModel: openrouterModel,
    pictureModel: "google-ai/imagen-3.0-generate-002",
    keys: { openrouter: "sk-video", google: "" },
    desktopVideo: supportedVideoBridge,
  });
  assert.equal(googlePic.ok, false);
  assert.equal(
    googlePic.blockers.some((b) => b.message === "Enter your Google API key in Settings to generate shot images."),
    true,
  );
});

test("preflight detects missing required local media", async () => {
  // 1. Missing finished take clip
  const missingTakeBoard: Storyboard = {
    story: "Test story",
    shots: [
      {
        ...validShot,
        selectedTakeId: "deleted-take",
        takes: [{ fileId: "deleted-take", source: { frame: null, prompt: "" } }],
      },
    ],
  };
  const takeCheck = await preflightStoryboardVideo({
    story: missingTakeBoard,
    videoModel: openrouterModel,
    desktopVideo: supportedVideoBridge,
    storageFile: async () => undefined,
  });
  assert.equal(takeCheck.ok, false);
  assert.equal(
    takeCheck.blockers.some((b) => b.message === "Shot 1 video clip is missing from local storage."),
    true,
  );

  // 2. Missing generated picture file
  const missingFrameBoard: Storyboard = {
    story: "Test story",
    shots: [{ ...validShot, generatedId: "missing-frame" }],
  };
  const frameCheck = await preflightStoryboardVideo({
    story: missingFrameBoard,
    videoModel: openrouterModel,
    keys,
    desktopVideo: supportedVideoBridge,
    storageFile: async () => undefined,
  });
  assert.equal(frameCheck.ok, false);
  assert.equal(
    frameCheck.blockers.some((b) => b.message === "Shot 1 image is missing from local storage."),
    true,
  );

  // 3. Missing canvas reference image
  const missingCanvasBoard: Storyboard = {
    story: "Test story",
    shots: [{ ...validShot, image: 2 }],
  };
  const canvasCheck = await preflightStoryboardVideo({
    story: missingCanvasBoard,
    videoModel: openrouterModel,
    keys,
    storyImages: [{ url: "blob:image-0" }],
    desktopVideo: supportedVideoBridge,
  });
  assert.equal(canvasCheck.ok, false);
  assert.equal(
    canvasCheck.blockers.some((b) => b.message === "Shot 1 referenced canvas image is missing."),
    true,
  );
});

test("preflight respects resumable jobs and avoids drawing pictures", async () => {
  const savedJob = {
    requestId: "job-123",
    source: shotTakeSource(validShot),
    model: openrouterModel,
    aspectRatio: "16:9",
  };
  const board: Storyboard = {
    story: "Resuming story",
    shots: [{ ...validShot, pendingTake: savedJob }],
  };

  const result = await preflightStoryboardVideo({
    story: board,
    videoModel: openrouterModel,
    keys,
    desktopVideo: supportedVideoBridge,
  });

  assert.equal(result.ok, true);
  assert.equal(result.resumes, 1);
  assert.equal(result.clips, 0);
  assert.equal(result.pictures, 0);
});

test("preflight blocks mismatched pending take job", async () => {
  const savedJob = {
    requestId: "job-123",
    source: shotTakeSource(validShot),
    model: "other/model",
    aspectRatio: "16:9",
  };
  const board: Storyboard = {
    story: "Mismatch story",
    shots: [{ ...validShot, pendingTake: savedJob }],
  };

  const result = await preflightStoryboardVideo({
    story: board,
    videoModel: openrouterModel,
    keys,
    desktopVideo: supportedVideoBridge,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers.some((b) => b.message === "Open Shot 1 settings and check its saved job before making the video."),
    true,
  );
});

test("preflight reports tool download size when tool needs downloading", async () => {
  const downloadBridge: DesktopVideoApi = {
    ...supportedVideoBridge,
    status: async () => ({ supported: true, installed: false, bytes: 45_000_000, downloading: null, error: null }),
  };
  const board: Storyboard = {
    story: "Test story",
    shots: [
      {
        ...validShot,
        selectedTakeId: "take-1",
        takes: [{ fileId: "take-1", source: { frame: null, prompt: "" } }],
      },
    ],
  };

  const result = await preflightStoryboardVideo({
    story: board,
    videoModel: "",
    desktopVideo: downloadBridge,
    storageFile: async () => new Blob(["data"]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.toolBytes, 45_000_000);
});
