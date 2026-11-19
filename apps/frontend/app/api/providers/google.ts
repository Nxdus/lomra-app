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
    if (!/^gemini-[a-z0-9.-]+$/.test(id) || !Array.isArray(methods) || !methods.includes("generateContent")) continue;
    if (/(tts|audio|live|embedding|robotics|computer-use|dialog|transcribe|omni|video)/.test(id)) continue;
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
export function veoOperation(result: unknown): { done: boolean; uri?: string } {
  const operation = result as { done?: unknown; error?: unknown; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: unknown } }[] } } };
  if (operation.done !== true) return { done: false };
  const uri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  // Only files hosted by the Gemini API may be downloaded with the user's key.
  return { done: true, uri: !operation.error && typeof uri === "string" && uri.startsWith(`${GOOGLE_API}/files/`) ? uri : undefined };
}
