/** What the user set for one local Stable Diffusion model; a missing value means the model's default. */
export type SdSettings = { negativePrompt?: string; seed?: number; steps?: number; cfg?: number; strength?: number };
/** What the engine used for one picture. `image`: it started from a picture; `mask`: it redrew only a brushed area. */
export type SdUsed = { seed: number; steps: number; cfg: number; negativePrompt?: string; strength?: number; image?: boolean; mask?: boolean };

export const sdNegativePromptLimit = 2000;
/** The desktop app's main process enforces the same limits (`sd-input.mjs`). */
export const sdRanges = {
  seed: { min: 0, max: 2147483647, whole: true },
  steps: { min: 1, max: 50, whole: true },
  cfg: { min: 0, max: 20, whole: false },
  strength: { min: 0, max: 1, whole: false },
} as const;
export type SdNumber = keyof typeof sdRanges;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function validSdRangeNumber(range: { min: number; max: number; whole: boolean }, value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max && (!range.whole || Number.isInteger(value));
}

export function validSdNumber(name: SdNumber, value: unknown): value is number {
  return validSdRangeNumber(sdRanges[name], value);
}

const validNegativePrompt = (value: unknown) => typeof value === "string" && value.length <= sdNegativePromptLimit;

export function validSdModelSettings(value: unknown) {
  return record(value) && Object.entries(value).every(([name, saved]) => name === "negativePrompt" ? validNegativePrompt(saved)
    : Object.hasOwn(sdRanges, name) && validSdNumber(name as SdNumber, saved));
}

/** The saved `sd-settings` setting: one entry per model id. */
export function validSdSettings(value: unknown) {
  return record(value) && Object.keys(value).length <= 200 &&
    Object.entries(value).every(([model, saved]) => /^[a-z0-9-]{1,64}$/.test(model) && validSdModelSettings(saved));
}

export function validSdUsed(value: unknown) {
  return record(value) && validSdNumber("seed", value.seed) && validSdNumber("steps", value.steps) && validSdNumber("cfg", value.cfg) &&
    (value.strength === undefined || validSdNumber("strength", value.strength)) &&
    (value.negativePrompt === undefined || validNegativePrompt(value.negativePrompt)) &&
    [value.image, value.mask].every((flag) => flag === undefined || typeof flag === "boolean");
}

/** One line per setting, for Canvas details and the handoff. */
export function sdDetails(used: SdUsed): { label: string; value: string }[] {
  return [
    { label: "Seed", value: String(used.seed) },
    { label: "Steps", value: String(used.steps) },
    { label: "CFG scale", value: String(used.cfg) },
    ...(used.image ? [{ label: "Started from", value: used.mask ? "Picture, brushed area only" : "Picture" }] : []),
    ...(used.strength === undefined ? [] : [{ label: "Strength", value: String(used.strength) }]),
    ...(used.negativePrompt ? [{ label: "Negative prompt", value: used.negativePrompt }] : []),
  ];
}
