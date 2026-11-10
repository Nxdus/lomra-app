export const modelViews = ["front", "back", "left", "right"] as const;
export type ModelView = typeof modelViews[number];
export type ModelViews = Partial<Record<ModelView, { url: string; name: string }>>;

type MultiviewConfig = { input: "named" | "array"; required: ModelView[]; min: number; order: readonly ModelView[]; pngJpegOnly?: boolean };
const hunyuan: MultiviewConfig = { input: "named", required: ["front", "back", "left"], min: 3, order: ["front", "back", "left"] };
const hi3d: MultiviewConfig = { input: "named", required: [], min: 1, order: modelViews };
const meshy: MultiviewConfig = { input: "array", required: [], min: 1, order: modelViews, pngJpegOnly: true };
const configs: Record<string, MultiviewConfig> = {
  "hitem3d/hi3d/v3.0/multi-view-to-3d": hi3d,
  "hitem3d/hi3d/multi-view-to-3d": hi3d,
  "fal-ai/hunyuan3d/v2/multi-view": hunyuan,
  "fal-ai/hunyuan3d/v2/multi-view/turbo": hunyuan,
  "meshy/v7.1/multi-image-to-3d": meshy,
  "meshy/v7/multi-image-to-3d": meshy,
  "fal-ai/trellis/multi": { input: "array", required: [], min: 1, order: modelViews },
  "tripo3d/tripo/v2.5/multiview-to-3d": { input: "named", required: ["front"], min: 1, order: modelViews },
  "tripo3d/h3.1/multiview-to-3d": { input: "array", required: ["front"], min: 2, order: ["front", "left", "back", "right"] },
};

export function multiviewConfig(model: string): MultiviewConfig | undefined {
  return Object.hasOwn(configs, model) ? configs[model] : undefined;
}
export function isMultiview(model: string) {
  return /multi(?:view|-view|-image)(?:-to-3d)?(?:\/|$)|\/multi$/.test(model);
}
export function multiviewRequirements(model: string) {
  const config = multiviewConfig(model);
  if (!config) return "This multiview model is not supported. Choose a supported model such as Meshy 7.1.";
  return `${config.min === config.order.length ? config.min : `${config.min}–${config.order.length}`} images${config.required.length ? `; required views: ${config.required.join(", ")}` : "; any views of the same object"}${config.pngJpegOnly ? "; PNG or JPEG only" : ""}`;
}
export function multiviewError(model: string, views: ModelViews): string | undefined {
  const config = multiviewConfig(model);
  if (!config) return multiviewRequirements(model);
  const missing = config.required.filter((view) => !views[view]);
  if (missing.length) return `Add ${missing.join(", ")} view${missing.length > 1 ? "s" : ""}.`;
  if (Object.keys(views).some((view) => !config.order.includes(view as ModelView))) return `This model accepts ${config.order.join(", ")} views only.`;
  if (Object.keys(views).length < config.min) return `Add at least ${config.min} view${config.min > 1 ? "s" : ""} of the same object.`;
  if (model === "tripo3d/h3.1/multiview-to-3d") {
    const last = Math.max(...Object.keys(views).map((view) => config.order.indexOf(view as ModelView)));
    const gaps = config.order.slice(0, last).filter((view) => !views[view]);
    if (gaps.length) return `Add ${gaps.join(", ")} views to preserve this model's front, left, back, right image order.`;
  }
  const urls = Object.values(views).map((view) => view.url);
  if (urls.some((url) => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || url.split(",")[1].length % 4 !== 0)) return "Use PNG, JPEG or WebP images.";
  if (config.pngJpegOnly && urls.some((url) => url.startsWith("data:image/webp;"))) return "This model accepts PNG or JPEG images. Convert WebP images before submitting.";
  if (new Set(urls).size !== urls.length) return "Use a different image for each view.";
  if (urls.reduce((sum, url) => sum + url.length, 0) > Math.ceil(20 * 1024 * 1024 / 3) * 4 + 256) return "View images exceed 20 MB. Use smaller images.";
}
export function multiviewInput(model: string, views: ModelViews) {
  const error = multiviewError(model, views);
  if (error) throw new Error(error);
  const config = multiviewConfig(model)!;
  const present = config.order.filter((view) => views[view]);
  return config.input === "array"
    ? { image_urls: present.map((view) => views[view]!.url) }
    : Object.fromEntries(present.map((view) => [`${view}_image_url`, views[view]!.url]));
}
