import { isSdModel, sdPrefix } from "@/components/prompt/generation";
import { sdNegativePromptLimit, sdRanges, validSdNumber, type SdSettings } from "@/lib/sd-settings";
import type { CanvasProvenance } from "./canvas-harness";
import type { ImageBounds } from "./image-canvas-resize";

export const aspectRatios = ["1:1", "3:4", "9:16", "4:3", "16:9"] as const;

/** True when `value` is a `W:H` aspect ratio with positive numbers. */
export function validAspectRatio(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16) return false;
  const match = /^(\d{1,3}(?:\.\d+)?):(\d{1,3}(?:\.\d+)?)$/.exec(value);
  if (!match) return false;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
}

export type ModelAvailability = "selectable" | "not-installed" | "unavailable";

export type ResolvedSetup = {
  prompt: string;
  model?: string;
  aspectRatio: string;
  sdModelId?: string;
  sdSettings?: SdSettings;
  selectedInputIds: string[];
  warnings: string[];
};

/**
 * Resolves prompt, model, local SD settings, aspect ratio, and surviving canvas inputs from provenance,
 * reporting missing models, missing source pictures, or non-stored brushed masks plainly.
 */
export function resolveSetupFromProvenance(
  provenance: CanvasProvenance,
  canvasItems: ReadonlyArray<{ id: string }>,
  checkModel: (model: string) => ModelAvailability,
  modelDisplayName?: (model: string) => string | undefined,
): ResolvedSetup {
  const warnings: string[] = [];
  const label = modelDisplayName?.(provenance.model) ?? provenance.model;
  const availability = checkModel(provenance.model);
  let model: string | undefined;
  if (availability === "selectable") model = provenance.model;
  else if (availability === "not-installed") warnings.push(`Model "${label}" is not installed.`);
  else warnings.push(`Model "${label}" is no longer selectable.`);

  let sdModelId: string | undefined;
  let sdSettings: SdSettings | undefined;
  if (isSdModel(provenance.model) && provenance.sd) {
    sdModelId = provenance.model.slice(sdPrefix.length);
    const { seed, steps, cfg, strength, negativePrompt } = provenance.sd;
    sdSettings = {
      ...(typeof negativePrompt === "string" && negativePrompt.trim() ? { negativePrompt: negativePrompt.slice(0, sdNegativePromptLimit) } : {}),
      ...(validSdNumber("seed", seed) ? { seed } : {}),
      ...(validSdNumber("steps", steps) ? { steps } : {}),
      ...(validSdNumber("cfg", cfg) ? { cfg } : {}),
      ...(strength !== undefined && validSdNumber("strength", strength) ? { strength } : {}),
    };
  }

  const canvasIds = new Set(canvasItems.map((item) => item.id));
  const selectedInputIds: string[] = [];
  const missingInputs: string[] = [];
  for (const input of provenance.selectedInputs ?? []) {
    if (canvasIds.has(input.id)) {
      if (!selectedInputIds.includes(input.id)) selectedInputIds.push(input.id);
    } else {
      missingInputs.push(input.name || input.id);
    }
  }
  if (missingInputs.length === 1) warnings.push(`Source picture "${missingInputs[0]}" is no longer on the canvas.`);
  else if (missingInputs.length > 1) warnings.push(`Source pictures no longer on the canvas: ${missingInputs.join(", ")}.`);

  if (provenance.sd?.mask) warnings.push("The brushed area itself is not stored.");

  return {
    prompt: provenance.prompt,
    model,
    aspectRatio: validAspectRatio(provenance.aspectRatio) ? provenance.aspectRatio : "",
    sdModelId,
    sdSettings,
    selectedInputIds,
    warnings,
  };
}

/** True when an item with `provenance` is eligible for one-click 4 local Stable Diffusion variations. */
export function canMakeVariationsFromProvenance(provenance?: CanvasProvenance): boolean {
  return !!provenance && isSdModel(provenance.model) && !!provenance.sd && !provenance.sd.mask;
}

function defaultRandomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & sdRanges.seed.max;
}

/** Picks `count` distinct valid SD seeds, none equal to `originalSeed`. */
export function variationSeeds(originalSeed: number, count = 4, nextSeed: () => number = defaultRandomSeed): number[] {
  const picked: number[] = [];
  const seen = new Set<number>([originalSeed]);
  for (let attempts = 0; picked.length < count && attempts < count * 50; attempts++) {
    const candidate = Math.min(sdRanges.seed.max, Math.max(sdRanges.seed.min, Math.trunc(nextSeed())));
    if (validSdNumber("seed", candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      picked.push(candidate);
    }
  }
  // Fallback sweep ensures termination even with a degenerate generator in tests or edge cases.
  for (let candidate = 0; picked.length < count && candidate <= sdRanges.seed.max; candidate++) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      picked.push(candidate);
    }
  }
  return picked;
}

function overlapsAny(box: ImageBounds, items: ReadonlyArray<ImageBounds>, pad: number) {
  return items.some((item) =>
    box.x < item.x + item.width + pad &&
    box.x + box.width + pad > item.x &&
    box.y < item.y + item.height + pad &&
    box.y + box.height + pad > item.y,
  );
}

/** Finds a tidy non-overlapping origin for a 2x2 variation grid near `original`. */
export function planVariationGroupOrigin(
  original: ImageBounds,
  cellSize: { width: number; height: number },
  existing: ReadonlyArray<ImageBounds>,
  { gap = 16, margin = 24 }: { gap?: number; margin?: number } = {},
): { x: number; y: number } {
  const obstacles = [...existing, original];
  const groupW = cellSize.width * 2 + gap;
  const groupH = cellSize.height * 2 + gap;
  const stepX = groupW + margin;
  const stepY = groupH + margin;

  // Prefer immediately right, below, left, above `original`, then outward rings sorted by closeness.
  const candidates: { x: number; y: number }[] = [
    { x: original.x + original.width + margin, y: original.y },
    { x: original.x, y: original.y + original.height + margin },
    { x: original.x - groupW - margin, y: original.y },
    { x: original.x, y: original.y - groupH - margin },
  ];
  for (const cand of candidates) {
    if (!overlapsAny({ ...cand, width: groupW, height: groupH }, obstacles, margin - 1)) return cand;
  }

  const ringCandidates: { x: number; y: number; dist: number }[] = [];
  const push = (x: number, y: number) => {
    const dist = Math.hypot(x - (original.x + original.width + margin), y - original.y);
    ringCandidates.push({ x, y, dist });
  };
  for (let ring = 1; ring <= 12; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        push(original.x + dx * stepX, original.y + dy * stepY);
      }
    }
  }
  for (const item of obstacles) {
    push(item.x + item.width + margin, original.y);
    push(original.x, item.y + item.height + margin);
    push(item.x + item.width + margin, item.y);
    push(item.x, item.y + item.height + margin);
  }
  ringCandidates.sort((a, b) => a.dist - b.dist);
  for (const cand of ringCandidates) {
    if (!overlapsAny({ x: cand.x, y: cand.y, width: groupW, height: groupH }, obstacles, margin - 1)) {
      return { x: cand.x, y: cand.y };
    }
  }

  const maxRight = Math.max(...obstacles.map((item) => item.x + item.width));
  return { x: maxRight + margin, y: original.y };
}

/** Position of slot `index` (0..3) inside a 2x2 variation group. */
export function variationSlotPosition(
  groupOrigin: { x: number; y: number },
  index: number,
  cellSize: { width: number; height: number },
  gap = 16,
): { x: number; y: number } {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: groupOrigin.x + col * (cellSize.width + gap),
    y: groupOrigin.y + row * (cellSize.height + gap),
  };
}

export type CompareFieldId = "model" | "prompt" | "seed" | "steps" | "cfg" | "strength" | "negativePrompt" | "size";

export type CompareInput = {
  id: string;
  name: string;
  provenance?: CanvasProvenance;
  naturalWidth?: number;
  naturalHeight?: number;
};

export type CompareRow = {
  id: CompareFieldId;
  label: string;
  differs: boolean;
  hasValue: boolean;
  values: string[];
};

const compareFieldDefs: { id: CompareFieldId; label: string; read: (item: CompareInput, modelLabel?: (model: string) => string | undefined) => { key: string; display: string } }[] = [
  {
    id: "model",
    label: "Model",
    read: ({ provenance }, modelLabel) => {
      const raw = provenance?.model ?? "";
      return { key: raw, display: raw ? (modelLabel?.(raw) ?? raw) : "—" };
    },
  },
  {
    id: "prompt",
    label: "Prompt",
    read: ({ provenance }) => {
      const raw = provenance?.prompt?.trim() ?? "";
      return { key: raw, display: raw || "—" };
    },
  },
  {
    id: "seed",
    label: "Seed",
    read: ({ provenance }) => {
      const val = provenance?.sd?.seed;
      return { key: val !== undefined ? String(val) : "", display: val !== undefined ? String(val) : "—" };
    },
  },
  {
    id: "steps",
    label: "Steps",
    read: ({ provenance }) => {
      const val = provenance?.sd?.steps;
      return { key: val !== undefined ? String(val) : "", display: val !== undefined ? String(val) : "—" };
    },
  },
  {
    id: "cfg",
    label: "CFG scale",
    read: ({ provenance }) => {
      const val = provenance?.sd?.cfg;
      return { key: val !== undefined ? String(val) : "", display: val !== undefined ? String(val) : "—" };
    },
  },
  {
    id: "strength",
    label: "Strength",
    read: ({ provenance }) => {
      const val = provenance?.sd?.strength;
      return { key: val !== undefined ? String(val) : "", display: val !== undefined ? String(val) : "—" };
    },
  },
  {
    id: "negativePrompt",
    label: "Negative prompt",
    read: ({ provenance }) => {
      const raw = provenance?.sd?.negativePrompt?.trim() ?? "";
      return { key: raw, display: raw || "—" };
    },
  },
  {
    id: "size",
    label: "Size",
    read: ({ naturalWidth, naturalHeight }) => {
      const key = naturalWidth && naturalHeight ? `${naturalWidth}x${naturalHeight}` : "";
      return { key, display: naturalWidth && naturalHeight ? `${naturalWidth} × ${naturalHeight}` : "—" };
    },
  },
];

/** Builds comparison rows across 2–4 pictures and marks only fields whose values differ. */
export function comparePictures(items: ReadonlyArray<CompareInput>, modelLabel?: (model: string) => string | undefined): CompareRow[] {
  return compareFieldDefs.map(({ id, label, read }) => {
    const entries = items.map((item) => read(item, modelLabel));
    const keys = entries.map((entry) => entry.key);
    const knownKeys = id === "size" ? keys.filter(Boolean) : keys;
    const differs = new Set(knownKeys).size > 1;
    const hasValue = keys.some(Boolean);
    return { id, label, differs, hasValue, values: entries.map((entry) => entry.display) };
  });
}
