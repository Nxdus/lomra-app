// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { expect, test } from "bun:test";
import { validateValue } from "../local-store/validation";
import {
  canMakeVariationsFromProvenance,
  comparePictures,
  planVariationGroupOrigin,
  planVariationSlot,
  resolveSetupFromProvenance,
  validAspectRatio,
  variationSeeds,
  variationSlotPosition,
} from "./provenance-setup";
import type { CanvasProvenance } from "./canvas-harness";

test("validAspectRatio accepts standard ratios and rejects unsafe or invalid strings", () => {
  for (const ok of ["1:1", "3:4", "9:16", "4:3", "16:9", "3:2", "21:9"]) {
    expect(validAspectRatio(ok)).toBe(true);
  }
  for (const bad of ["", "0:1", "1:0", "-1:1", "16/9", "wide", "1:1:1", "1234:1", "1".repeat(20), null, 42]) {
    expect(validAspectRatio(bad)).toBe(false);
  }
  // Validation accepts new aspectRatio and older provenance without it.
  expect(() => validateValue("canvas", "default", [
    { id: "a", name: "a.png", type: "image/png", lastModified: 1, x: 0, y: 0, width: 1, height: 1, harness: { role: "Output", provenance: { model: "sd/sd-turbo", prompt: "fox", aspectRatio: "16:9" } } },
    { id: "b", name: "b.png", type: "image/png", lastModified: 1, x: 0, y: 0, width: 1, height: 1, harness: { role: "Output", provenance: { model: "sd/sd-turbo", prompt: "old" } } },
  ])).not.toThrow();
  expect(() => validateValue("canvas", "default", [
    { id: "a", name: "a.png", type: "image/png", lastModified: 1, x: 0, y: 0, width: 1, height: 1, harness: { role: "Output", provenance: { model: "sd/sd-turbo", prompt: "fox", aspectRatio: "bad" } } },
  ])).toThrow("Invalid saved state");
});

test("resolveSetupFromProvenance restores full setup and warns plainly when model, source, or brush mask is missing", () => {
  const full: CanvasProvenance = {
    model: "sd/sd-turbo",
    prompt: "a cozy cabin",
    aspectRatio: "16:9",
    selectedInputs: [{ id: "src-1", name: "sketch.png" }, { id: "src-gone", name: "old-ref.png" }],
    sd: { seed: 42, steps: 4, cfg: 1, strength: 0.6, negativePrompt: "blurry", image: true, mask: true },
  };
  const resolved = resolveSetupFromProvenance(
    full,
    [{ id: "src-1" }],
    () => "selectable",
    (model) => (model === "sd/sd-turbo" ? "SD Turbo" : undefined),
  );
  expect(resolved.prompt).toBe("a cozy cabin");
  expect(resolved.model).toBe("sd/sd-turbo");
  expect(resolved.aspectRatio).toBe("16:9");
  expect(resolved.sdModelId).toBe("sd-turbo");
  expect(resolved.sdSettings).toEqual({ negativePrompt: "blurry", seed: 42, steps: 4, cfg: 1, strength: 0.6 });
  expect(resolved.selectedInputIds).toEqual(["src-1"]);
  expect(resolved.warnings).toEqual([
    'Source picture "old-ref.png" is no longer on the canvas.',
    "The brushed area itself is not stored.",
  ]);

  // Missing local model still restores prompt, sdSettings, and surviving sources.
  const uninstalled = resolveSetupFromProvenance(
    { model: "sd/sd15", prompt: "mountain", selectedInputs: [{ id: "src-1", name: "sketch.png" }], sd: { seed: 7, steps: 20, cfg: 7 } },
    [{ id: "src-1" }],
    () => "not-installed",
    () => "Stable Diffusion 1.5",
  );
  expect(uninstalled.model).toBeUndefined();
  expect(uninstalled.aspectRatio).toBe("");
  expect(uninstalled.sdSettings).toEqual({ seed: 7, steps: 20, cfg: 7 });
  expect(uninstalled.selectedInputIds).toEqual(["src-1"]);
  expect(uninstalled.warnings).toEqual(['Model "Stable Diffusion 1.5" is not installed.']);

  const unavailable = resolveSetupFromProvenance(
    { model: "openai/gpt-image-1", prompt: "logo" },
    [],
    () => "unavailable",
  );
  expect(unavailable.model).toBeUndefined();
  expect(unavailable.warnings).toEqual(['Model "openai/gpt-image-1" is no longer selectable.']);
});

test("variation eligibility rejects hosted models and brushed-area results", () => {
  expect(canMakeVariationsFromProvenance({ model: "sd/sd-turbo", prompt: "fox", sd: { seed: 1, steps: 4, cfg: 1 } })).toBe(true);
  expect(canMakeVariationsFromProvenance({ model: "sd/sd-turbo", prompt: "fox", sd: { seed: 1, steps: 4, cfg: 1, image: true, strength: 0.6 } })).toBe(true);
  expect(canMakeVariationsFromProvenance({ model: "sd/sd-turbo", prompt: "fox", sd: { seed: 1, steps: 4, cfg: 1, image: true, mask: true } })).toBe(false);
  expect(canMakeVariationsFromProvenance({ model: "openai/gpt-image-1", prompt: "fox" })).toBe(false);
  expect(canMakeVariationsFromProvenance(undefined)).toBe(false);
});

test("variationSeeds returns 4 distinct valid seeds excluding the original seed", () => {
  const sequence = [10, 10, 20, 30, 10, 40, 50];
  let index = 0;
  const seeds = variationSeeds(10, 4, () => sequence[index++] ?? 99);
  expect(seeds).toEqual([20, 30, 40, 50]);
  expect(new Set(seeds).size).toBe(4);
  expect(seeds.includes(10)).toBe(false);
});

test("planVariationGroupOrigin places a tidy 2x2 group without overlapping original or existing items", () => {
  const original = { x: 0, y: 0, width: 200, height: 200 };
  const cell = { width: 200, height: 200 };
  const blockerRight = { x: 240, y: 0, width: 250, height: 250 };
  const origin = planVariationGroupOrigin(original, cell, [blockerRight]);
  const slots = [0, 1, 2, 3].map((i) => ({ ...variationSlotPosition(origin, i, cell), ...cell }));

  // Should avoid original and blockerRight completely.
  for (const slot of slots) {
    for (const item of [original, blockerRight]) {
      const overlaps =
        slot.x < item.x + item.width &&
        slot.x + slot.width > item.x &&
        slot.y < item.y + item.height &&
        slot.y + slot.height > item.y;
      expect(overlaps).toBe(false);
    }
  }
  // Tidy 2x2 grid spacing check.
  expect(slots[1].x - (slots[0].x + cell.width)).toBe(16);
  expect(slots[2].y - (slots[0].y + cell.height)).toBe(16);
  expect(slots[3].x).toBe(slots[1].x);
  expect(slots[3].y).toBe(slots[2].y);

  // If a user drops an image onto slot 1 mid-batch, planVariationSlot avoids overlapping it.
  const droppedOnSlot1 = { ...slots[1], width: 180, height: 180 };
  const placed1 = planVariationSlot(original, 1, cell, [original, blockerRight, slots[0], droppedOnSlot1], origin);
  expect(
    placed1.position.x < droppedOnSlot1.x + droppedOnSlot1.width &&
    placed1.position.x + cell.width > droppedOnSlot1.x &&
    placed1.position.y < droppedOnSlot1.y + droppedOnSlot1.height &&
    placed1.position.y + cell.height > droppedOnSlot1.y,
  ).toBe(false);
});

test("comparePictures highlights only fields that differ and supports pictures without provenance", () => {
  const rows = comparePictures([
    { id: "1", name: "a.png", naturalWidth: 512, naturalHeight: 512, provenance: { model: "sd/sd-turbo", prompt: "fox", sd: { seed: 1, steps: 4, cfg: 1 } } },
    { id: "2", name: "b.png", naturalWidth: 512, naturalHeight: 512, provenance: { model: "sd/sd-turbo", prompt: "fox", sd: { seed: 2, steps: 4, cfg: 1 } } },
  ]);
  expect(rows.filter((r) => r.differs).map((r) => r.id)).toEqual(["seed"]);
  expect(rows.find((r) => r.id === "strength")?.hasValue).toBe(false);
  expect(rows.find((r) => r.id === "negativePrompt")?.hasValue).toBe(false);

  const mixed = comparePictures([
    { id: "1", name: "plain.png", naturalWidth: 800, naturalHeight: 600 },
    { id: "2", name: "gen.png", naturalWidth: 512, naturalHeight: 512, provenance: { model: "sd/sd-turbo", prompt: "fox", sd: { seed: 2, steps: 4, cfg: 1, strength: 0.7, negativePrompt: "blur" } } },
  ]);
  expect(mixed.filter((r) => r.differs).map((r) => r.id)).toEqual(["model", "prompt", "seed", "steps", "cfg", "strength", "negativePrompt", "size"]);

  const bothPlain = comparePictures([
    { id: "1", name: "a.png", naturalWidth: 512, naturalHeight: 512 },
    { id: "2", name: "b.png", naturalWidth: 1024, naturalHeight: 512 },
  ]);
  expect(bothPlain.filter((r) => r.differs).map((r) => r.id)).toEqual(["size"]);
});
