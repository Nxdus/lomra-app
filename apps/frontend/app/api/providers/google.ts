// Google AI Studio (Gemini API). Chat and images use its OpenAI-compatible endpoint; the model list uses the native API.
export const GOOGLE_MODEL_PREFIX = "google-ai/";
export const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta";

const unsupportedSchemaKeys = new Set(["additionalProperties", "exclusiveMinimum", "multipleOf", "uniqueItems", "anyOf", "const"]);

/** Gemini accepts only a subset of JSON Schema in function declarations; drop the rest (arguments are validated again on our side). */
export function googleTools<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => googleTools(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !unsupportedSchemaKeys.has(key)).map(([key, item]) => [key, googleTools(item)])) as T;
}

const KNOWN_VEO = [
  ["veo-3.1-generate-preview", "Veo 3.1"],
  ["veo-3.1-fast-generate-preview", "Veo 3.1 Fast"],
  ["veo-3.1-lite-generate-preview", "Veo 3.1 Lite"],
];

export const VEO_MODEL = /^veo-[a-z0-9.-]+$/;
/** Gemini Omni makes video through the Interactions API (one synchronous call), not `predictLongRunning`. */
export const OMNI_MODEL = /^gemini-omni-[a-z0-9.-]+$/;

/** Interactions request for an Omni video; the output is delivered as a Files API URI so it can be polled and downloaded. */
export function omniRequest(model: string, prompt: string, image?: string, aspectRatio?: string, duration?: number) {
  const frame = image ? /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(image) : null;
  return {
    model,
    input: frame ? [{ type: "text", text: prompt }, { type: "image", data: frame[2], mime_type: frame[1] }] : prompt,
    response_format: {
      type: "video",
      // Omni offers only 16:9 and 9:16.
      aspect_ratio: aspectRatio === "9:16" || aspectRatio === "3:4" ? "9:16" : "16:9",
      ...(duration ? { duration: `${Math.min(15, Math.max(3, duration))}s` } : {}),
      delivery: "uri",
    },
  };
}

/** The Files API id of the video in a finished Omni interaction. */
export function omniFileId(result: unknown): string | undefined {
  const steps = (result as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return undefined;
  for (const step of steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const part of step.content) {
      const uri: unknown = part?.type === "video" ? part.uri : undefined;
      if (typeof uri !== "string" || !uri.startsWith(`${GOOGLE_API}/files/`)) continue;
      const id = uri.slice(`${GOOGLE_API}/files/`.length).split(/[:?/]/)[0];
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return id;
    }
  }
  return undefined;
}

/** Usable chat, image and Veo video models from the native `models.list` response. */
export function googleModels(result: unknown) {
  const list = (result as { models?: unknown })?.models;
  if (!Array.isArray(list)) return [];
  const models: { id: string; name: string; category: "llm" | "picture" | "video" }[] = [];
  for (const item of list) {
    const name = typeof item?.name === "string" ? item.name : "";
    const id = name.replace(/^models\//, "");
    const methods: unknown = item?.supportedGenerationMethods;
    const label = typeof item?.displayName === "string" && item.displayName.trim() ? item.displayName.trim().slice(0, 80) : id;
    if (VEO_MODEL.test(id) && Array.isArray(methods) && methods.includes("predictLongRunning")) {
      models.push({ id, name: label, category: "video" });
      continue;
    }
    if (OMNI_MODEL.test(id)) {
      models.push({ id, name: label, category: "video" });
      continue;
    }
    if (!/^gemini-[a-z0-9.-]+$/.test(id) || !Array.isArray(methods) || !methods.includes("generateContent")) continue;
    if (/(tts|audio|live|embedding|robotics|computer-use|dialog|transcribe|video)/.test(id)) continue;
    models.push({ id, name: label, category: /image|nano-banana/.test(id) ? "picture" : "llm" });
  }
  // Cap per category: a global cap would cut off Veo (sorted last) whenever many Gemini models exist.
  // models.list may omit Veo even when the key can call it, so offer the known ones then.
  if (!models.some((model) => model.category === "video")) {
    models.push(...KNOWN_VEO.map(([id, name]) => ({ id, name, category: "video" as const })));
  }
  const counts = { llm: 0, picture: 0, video: 0 };
  return models.sort((a, b) => a.id.localeCompare(b.id)).filter((model) => ++counts[model.category] <= 60);
}

/** Finished Veo operation: the generated video's download URI, or why there is none. */
export function veoOperation(result: unknown): { done: boolean; uri?: string; error?: unknown } {
  const operation = result as { done?: unknown; error?: unknown; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: unknown } }[] } } };
  if (operation.done !== true) return { done: false };
  const uri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  // Only files hosted by the Gemini API may be downloaded with the user's key.
  return { done: true, error: operation.error, uri: !operation.error && typeof uri === "string" && uri.startsWith(`${GOOGLE_API}/files/`) ? uri : undefined };
}
