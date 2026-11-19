import { isMultiview } from "@/components/prompt/multiview";
import { usd } from "./price";

// Curated choices; review these IDs when replacing a flagship or budget model.
const selections = {
  llm: [
    { id: "anthropic/claude-opus-5.5", tier: "Top Tier" },
    { id: "google/gemini-3.1-flash-lite", tier: "Economy" },
  ],
  picture: [
    { id: "openai/gpt-5.4-image-2", tier: "Top Tier" },
    { id: "google/gemini-3.1-flash-lite-image", tier: "Economy" },
  ],
  video: [
    { id: "google/veo-3.1", tier: "Top Tier" },
    { id: "google/veo-3.1-lite", tier: "Economy" },
  ],
};

const rate = (value: unknown) => {
  const number = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

// Display-only price from OpenRouter's catalog (USD): undefined when the catalog gives none.
function priceLabel(category: "llm" | "picture" | "video", item: { pricing?: Record<string, unknown>; pricing_skus?: Record<string, unknown> }) {
  if (category === "video") {
    const skus = Object.entries(item.pricing_skus ?? {}).flatMap(([key, value]) => {
      const price = rate(value);
      return price === undefined || price === 0 || /long|reference|continuation|megapixel|minimum|image_input/.test(key) ? [] : [{ key, price }];
    });
    const seconds = skus.filter(({ key }) => /second/.test(key) && !/token/.test(key))
      .map(({ key, price }) => key.startsWith("cents_") ? price / 100 : price);
    if (seconds.length) return `from ${usd(Math.min(...seconds))}/sec`;
    const tokens = skus.filter(({ key }) => key.startsWith("video_tokens")).map(({ price }) => price * 1_000_000);
    return tokens.length ? `from ${usd(Math.min(...tokens))}/1M tokens` : undefined;
  }
  const pricing = item.pricing;
  if (!pricing) return undefined;
  const perImage = rate(pricing.image);
  if (category === "picture" && perImage) return `${usd(perImage)}/image`;
  const imageTokens = rate(pricing.image_output) ?? rate(pricing.image_token);
  if (category === "picture" && imageTokens) return `${usd(imageTokens * 1_000_000)}/1M image tokens`;
  const input = rate(pricing.prompt);
  const output = rate(pricing.completion);
  if (input === undefined || output === undefined) return undefined;
  if (!input && !output) return "Free";
  return `${usd(input * 1_000_000)} in · ${usd(output * 1_000_000)} out /1M`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get("category");
  const all = params.get("all") === "true";
  if (category === "3d" && !all) {
    // shortcut: curated 3D endpoints; use fal's catalog when more families are needed.
    return Response.json({ models: [
      { id: "fal-ai/hunyuan-3d/v3.1/pro/text-to-3d", name: "Hunyuan 3D 3.1 Pro", tier: "Top Tier", capabilities: ["text-to-3d"] },
      { id: "fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d", name: "Hunyuan 3D 3.1 Rapid", tier: "Economy", capabilities: ["text-to-3d"] },
      { id: "fal-ai/hunyuan3d-v3/image-to-3d", name: "Hunyuan3D V3", capabilities: ["image-to-3d"] },
      { id: "hitem3d/hi3d/v3.0/multi-view-to-3d", name: "Hi3D V3 Multiview", capabilities: ["multi-view-to-3d"] },
      { id: "fal-ai/hunyuan3d/v2/multi-view", name: "Hunyuan3D V2 Multiview", capabilities: ["multi-view-to-3d"] },
      { id: "fal-ai/trellis", name: "Trellis", capabilities: ["image-to-3d"] },
    ] });
  }
  if (category !== "llm" && category !== "picture" && category !== "video" && category !== "3d") {
    return Response.json({ message: "Unknown model category" }, { status: 400 });
  }
  try {
    if (category === "3d") {
      const catalogs = await Promise.all(["text-to-3d", "image-to-3d"].map(async (capability) => {
        const response = await fetch(`https://api.fal.ai/v1/models?category=${capability}&limit=100`, {
          next: { revalidate: 3600 }, signal: AbortSignal.timeout(15_000), redirect: "error",
        });
        if (!response.ok) throw new Error("Catalog unavailable");
        const result = await response.json();
        if (!Array.isArray(result?.models)) throw new Error("Invalid catalog");
        return result.models.filter((item: { endpoint_id?: string; metadata?: { display_name?: string; category?: string; status?: string } } | null) =>
          typeof item?.endpoint_id === "string" && typeof item.metadata?.display_name === "string" && item.metadata.category === capability && item.metadata.status === "active"
        ).map((item: { endpoint_id: string; metadata: { display_name: string } }) => ({ id: item.endpoint_id, name: item.metadata.display_name, capabilities: [isMultiview(item.endpoint_id) ? "multi-view-to-3d" : capability] }));
      }));
      return Response.json({ models: catalogs.flat() });
    }
    const endpoint = category === "video" ? "videos/models" : category === "picture" ? "models?output_modalities=image" : "models";
    const response = await fetch(`https://openrouter.ai/api/v1/${endpoint}`, {
      next: { revalidate: 3600 }, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (!response.ok) throw new Error("Catalog unavailable");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("data" in result) || !Array.isArray(result.data)) {
      throw new Error("Invalid catalog");
    }
    const catalog = result.data.filter((item) => {
      if (typeof item?.id !== "string" || typeof item.name !== "string") return false;
      if (category === "video") return true;
      const outputs = item.architecture?.output_modalities;
      if (!Array.isArray(outputs) || outputs.includes("video")) return false;
      return category === "picture" ? outputs.includes("image") : outputs.includes("text") && !outputs.includes("image");
    }).map((item) => {
      const price = priceLabel(category, item);
      return { id: item.id, name: item.name, ...(price && { price }) };
    });
    return Response.json({ models: all ? catalog : selections[category].flatMap(({ id, tier }) => {
      const model = catalog.find((item) => item.id === id);
      return model ? [{ ...model, tier }] : [];
    }) });
  } catch {
    return Response.json({ message: "Could not load models. Try again." }, { status: 502 });
  }
}
