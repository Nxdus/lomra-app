// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import type { SdProfile, SdStatus } from "./desktop";
import { pictureCapabilities } from "./picture-capabilities";

const turboProfile: SdProfile = {
  id: "turbo",
  name: "Turbo (few steps)",
  note: "512 px, 4 steps",
  size: 512,
  steps: 4,
  cfg: 1,
  strength: 0.75,
  ranges: {
    steps: { min: 1, max: 12, whole: true },
    cfg: { min: 1, max: 1, whole: false },
    strength: { min: 0, max: 1, whole: false },
  },
  capabilities: {
    textToImage: true,
    imageToImage: true,
    inpaint: true,
    negativePrompt: false,
    cfg: false,
    strength: true,
    outpaint: false,
    referencePictures: false,
  },
};

const fakeProfile: SdProfile = {
  id: "fake-edit",
  name: "Fake Edit",
  note: "768 px, 8 steps",
  size: 768,
  steps: 8,
  cfg: 3,
  strength: 0.6,
  ranges: {
    steps: { min: 4, max: 16, whole: true },
    cfg: { min: 2, max: 5, whole: false },
    strength: { min: 0.2, max: 0.8, whole: false },
  },
  capabilities: {
    textToImage: false,
    imageToImage: true,
    inpaint: false,
    negativePrompt: false,
    cfg: true,
    strength: true,
    outpaint: true,
    referencePictures: true,
  },
};

const status: SdStatus = {
  supported: true,
  engine: true,
  engineBytes: 0,
  gpuBytes: 0,
  downloading: null,
  queued: [],
  error: null,
  profiles: [turboProfile, fakeProfile],
  models: [
    { id: "sd-turbo", name: "SD Turbo", quality: "Fast", note: "", bytes: 1, recommended: true, installed: true, partial: 0, custom: false, inpaint: false, profile: turboProfile },
    { id: "fake", name: "Fake", quality: "Fake", note: "", bytes: 1, recommended: false, installed: true, partial: 0, custom: true, inpaint: false, profile: fakeProfile },
  ],
};

test("pictureCapabilities derives local model capabilities and ranges from sdStatus", () => {
  const turbo = pictureCapabilities("sd/sd-turbo", status);
  expect(turbo.negativePrompt).toBe(false);
  expect(turbo.cfg).toBe(false);
  expect(turbo.outpaint).toBe(false);
  expect(turbo.referencePictures).toBe(false);
  expect(turbo.maxInputImages).toBe(1);
  expect(turbo.defaults).toEqual({ steps: 4, cfg: 1, strength: 0.75 });
  expect(turbo.ranges.steps).toEqual({ min: 1, max: 12, whole: true });

  const fake = pictureCapabilities("sd/fake", status);
  expect(fake.textToImage).toBe(false);
  expect(fake.inpaint).toBe(false);
  expect(fake.outpaint).toBe(true);
  expect(fake.referencePictures).toBe(true);
  expect(fake.maxInputImages).toBe(10);
  expect(fake.ranges.cfg).toEqual({ min: 2, max: 5, whole: false });

  const fallback = pictureCapabilities("sd/missing", undefined);
  expect(fallback.maxInputImages).toBe(1);
  expect(fallback.outpaint).toBe(false);
  expect(fallback.referencePictures).toBe(false);
});

test("pictureCapabilities reports hosted and Google picture model capabilities", () => {
  const google = pictureCapabilities("google-ai/imagen-3.0-generate-002", status);
  expect(google.textToImage).toBe(true);
  expect(google.imageToImage).toBe(false);
  expect(google.inpaint).toBe(false);
  expect(google.outpaint).toBe(false);
  expect(google.referencePictures).toBe(false);
  expect(google.maxInputImages).toBe(0);

  for (const hosted of ["openrouter/openai/gpt-image-1", "chatgpt-browser/create-image", "gemini-browser/create-image"]) {
    const caps = pictureCapabilities(hosted, status);
    expect(caps.textToImage).toBe(true);
    expect(caps.imageToImage).toBe(true);
    expect(caps.inpaint).toBe(true);
    expect(caps.outpaint).toBe(true);
    expect(caps.referencePictures).toBe(true);
    expect(caps.maxInputImages).toBe(10);
  }
});
