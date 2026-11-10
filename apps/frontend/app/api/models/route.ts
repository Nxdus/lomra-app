import { isMultiview } from "@/components/prompt/multiview";

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
    const response = await fetch(`https://openrouter.ai/api/v1/${category === "video" ? "videos/models" : "models"}`, {
      next: { revalidate: 3600 }, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (!response.ok) throw new Error("Catalog unavailable");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("data" in result) || !Array.isArray(result.data)) {
      throw new Error("Invalid catalog");
    }
    const models: { id: string; name: string; tier: string }[] = [];
    if (all) {
      return Response.json({ models: result.data.filter((item) => {
        if (typeof item?.id !== "string" || typeof item.name !== "string") return false;
        const outputs = item.architecture?.output_modalities;
        return category === "video" || (Array.isArray(outputs) && outputs.includes(category === "picture" ? "image" : "text"));
      }).map((item) => ({ id: item.id, name: item.name })) });
    }
    for (const choice of selections[category]) {
      const model = result.data.find((item) => item?.id === choice.id && typeof item.name === "string");
      if (!model) continue;
      const outputs = model.architecture?.output_modalities;
      if (category !== "video" && (!Array.isArray(outputs) || !outputs.includes(category === "picture" ? "image" : "text"))) continue;
      models.push({ id: model.id, name: model.name, tier: choice.tier });
    }
    return Response.json({ models });
  } catch {
    return Response.json({ message: "Could not load models. Try again." }, { status: 502 });
  }
}
