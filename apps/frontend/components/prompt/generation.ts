import { processImage, type ImageOperation } from "./image-tools";
import { animationInput, animationFiles, rigFiles } from "./animation";
import { localMediaTool, mediaToolModel, validateMediaTool, type MediaTool, type ToolSource } from "./media-tools";
import type { Provider, ProviderRequest } from "@/components/api-provider";

export type Category = "picture" | "video" | "3d";
import { isMultiview, multiviewInput, type ModelView, type ModelViews } from "./multiview";
export { modelViews, isMultiview, multiviewError, type ModelView, type ModelViews } from "./multiview";
export type GenerationTask = { category: Category; prompt: string; aspectRatio?: string; texture?: boolean; viewIndices?: Partial<Record<ModelView, number>>; operation?: ImageOperation; mediaTool?: MediaTool };
export type GeneratedFile = { url: string; name: string; kind: "image" | "video" | "file" };
export type Generation = GenerationTask & {
  id: string; model: string; status: string; requestId?: string; files?: GeneratedFile[]; error?: string; views?: ModelViews; messageIndex?: number; summary?: string;
  motionJobs?: { rig?: string; motion?: string };
};
export type ConversationMessage = { role: "user" | "assistant"; content: string };
type RequestProvider = (provider: Provider, options: ProviderRequest) => Promise<unknown>;

export function selectedModel(models: string[], category: string) {
  return models.find((model) => model.startsWith(`${category}:`))?.slice(category.length + 1);
}

export function requiresImage(model: string) {
  return /(?:image-to-3d|multiview-to-3d|multi-view-to-3d|multi-image-to-3d)/.test(model)
    || /^fal-ai\/(?:trellis(?:-2)?|pixal3d|hunyuan3d\/v2)(?:\/|$)/.test(model);
}

export function safeMediaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function imageFiles(value: unknown): GeneratedFile[] {
  const result = value as { data?: { b64_json?: string; media_type?: string; url?: string }[] };
  const files: GeneratedFile[] = [];
  for (const [index, item] of (result?.data ?? []).entries()) {
    const mime = item.media_type ?? "image/png";
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) continue;
    const url = item.b64_json ? `data:${mime};base64,${item.b64_json}` : item.url;
    if (url && (item.b64_json || safeMediaUrl(url))) files.push({ url, name: `Image ${index + 1}`, kind: "image" });
  }
  return files;
}

export function modelFiles(value: unknown): GeneratedFile[] {
  const mesh = (value as { model_mesh?: { url?: string; file_name?: string } })?.model_mesh;
  const result = value as { model_urls?: Record<string, { url?: string }>; thumbnail?: { url?: string }; model_obj?: { url?: string }; model_glb?: { url?: string }; material_mtl?: { url?: string }; texture?: { url?: string } };
  const files: GeneratedFile[] = [];
  if (safeMediaUrl(mesh?.url)) {
    const extension = (mesh.file_name ?? new URL(mesh.url).pathname).split(".").pop()?.toUpperCase();
    files.push({ url: mesh.url, name: extension && ["GLB", "OBJ", "STL", "FBX", "USDZ"].includes(extension) ? extension : "GLB", kind: "file" });
  }
  if (safeMediaUrl(result?.thumbnail?.url)) files.push({ url: result.thumbnail.url, name: "3D preview", kind: "image" });
  for (const [format, file] of Object.entries(result?.model_urls ?? {})) {
    if (safeMediaUrl(file?.url)) files.push({ url: file.url, name: format.toUpperCase(), kind: "file" });
  }
  for (const [name, file] of [["GLB", result?.model_glb], ["OBJ", result?.model_obj], ["MTL", result?.material_mtl], ["TEXTURE", result?.texture]] as const) {
    if (!files.some((item) => item.name === name) && safeMediaUrl(file?.url)) files.push({ url: file.url, name, kind: "file" });
  }
  return files.some((file) => file.kind === "file") ? files : [];
}

export function canvasResults(files: GeneratedFile[], category: Category) {
  if (category !== "3d") return files.filter((file) => file.kind !== "file");
  const model = files.find((file) => file.kind === "file" && file.name === "GLB")
    ?? files.find((file) => file.kind === "file" && file.name === "OBJ");
  return model ? [model] : [];
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function generateMotion(task: Generation, request: RequestProvider, signal: AbortSignal, update: (change: Partial<Generation>) => void, sources: ToolSource[]) {
  const tool = task.mediaTool;
  if (tool?.name !== "animate_3d" || !tool.motion_prompt) throw new Error("A motion prompt is required.");
  const jobs = { ...task.motionJobs };
  const outputs: Record<string, unknown> = {};
  for (const stage of ["rig", "motion"] as const) {
    signal.throwIfAborted();
    const model = stage === "rig" ? "fal-ai/meshy/rigging" : "fal-ai/hunyuan-motion";
    let id = jobs[stage];
    if (!id) {
      const input = stage === "rig" ? await animationInput(tool, sources, signal) : { prompt: tool.motion_prompt, duration: tool.duration ?? 4, output_format: "fbx" };
      signal.throwIfAborted();
      const submitted = await request("fal", { model, action: "submit", input, signal: AbortSignal.timeout(60_000) }) as { request_id?: string };
      if (!submitted.request_id || !/^[a-zA-Z0-9_-]{1,100}$/.test(submitted.request_id)) throw new Error("Provider returned no valid motion job ID");
      id = jobs[stage] = submitted.request_id;
      update({ motionJobs: { ...jobs }, requestId: id });
    }
    const deadline = Date.now() + 20 * 60_000;
    while (true) {
      signal.throwIfAborted();
      update({ status: stage === "rig" ? "Rigging character" : "Generating custom motion" });
      const result = await request("fal", { model, action: "status", requestId: id, signal }) as { status?: string };
      if (result.status === "COMPLETED") {
        outputs[stage] = await request("fal", { model, action: "result", requestId: id, signal });
        break;
      }
      if (!["IN_QUEUE", "IN_PROGRESS"].includes(result.status ?? "")) throw new Error(`The ${stage} job failed at Fal.`);
      if (Date.now() >= deadline) throw new Error("Still waiting. Use Check job to continue without generating again.");
      await pause(5000, signal);
    }
  }
  signal.throwIfAborted();
  const rig = outputs.rig as { rigged_character_glb?: { url?: string } };
  const motion = outputs.motion as { fbx_file?: { url?: string } };
  if (!safeMediaUrl(rig?.rigged_character_glb?.url) || !safeMediaUrl(motion?.fbx_file?.url)) throw new Error("Fal returned no rigged GLB or motion FBX.");
  update({ status: "Fitting motion to character" });
  const files = await (await import("./retarget-motion")).fitMotion(rig.rigged_character_glb.url, motion.fbx_file.url, signal);
  update({ summary: "Custom motion fitted to the character's rest pose and leg proportions. Check foot contact and limb overlap; automatic fitting does not guarantee collision-free motion." });
  return files;
}

export async function generate(
  task: Generation, request: RequestProvider, signal: AbortSignal,
  update: (change: Partial<Generation>) => void,
  imageUrl?: string,
  images: string[] = imageUrl ? [imageUrl] : [],
  sources: ToolSource[] = [],
): Promise<GeneratedFile[]> {
  signal.throwIfAborted();
  if (task.operation) return processImage(task.operation, images, signal);
  if (task.mediaTool) {
    validateMediaTool(task.mediaTool);
    if (task.model !== mediaToolModel(task.mediaTool)) throw new Error("Invalid media tool model.");
    if (task.model === "Local media tools") return localMediaTool(task.mediaTool, sources, signal, summary => update({ summary }));
    if (task.mediaTool.name === "animate_3d" && task.mediaTool.motion_prompt) {
      try { return await generateMotion(task, request, signal, update, sources); }
      catch (cause) {
        if (signal.aborted) throw new Error("Stopped checking motion jobs. Submitted Fal jobs may still finish and charge; use Check job to resume without resubmitting.");
        throw cause;
      }
    }
  }
  const provider = task.category === "3d" || task.mediaTool ? "fal" : "openrouter";
  const call = (options: ProviderRequest) => request(provider, { ...options, model: task.model, signal });
  if (task.category === "picture" && !task.mediaTool) {
    const files = imageFiles(await call({ action: "image", input: task.prompt, images, ...(task.aspectRatio ? { aspectRatio: task.aspectRatio } : {}) }));
    if (!files.length) throw new Error("The image model returned no supported images");
    return files;
  }
  let requestId = task.requestId;
  try {
    if (!requestId) {
      if (task.texture !== undefined && (typeof task.texture !== "boolean" || task.category !== "3d" || task.model !== "fal-ai/hunyuan3d/v2/multi-view")) throw new Error("Texture control is supported only for Hunyuan3D V2 Multiview.");
      const multi = task.category === "3d" && isMultiview(task.model);
      const imageInput = task.category === "3d" && !multi && requiresImage(task.model);
      if (imageInput && !imageUrl) throw new Error("Select one image on the canvas before using an image-to-3D model.");
      const viewInput = {
        ...(multi ? multiviewInput(task.model, task.views ?? {}) : {}),
        ...(task.texture === undefined ? {} : { textured_mesh: task.texture }),
      };
      let toolInput;
      if (task.mediaTool?.name === "animate_3d" || task.mediaTool?.name === "rig_3d") toolInput = await animationInput(task.mediaTool, sources, signal);
      if (task.mediaTool && (task.mediaTool.name === "remove_background" || task.mediaTool.name === "upscale_image")) {
        const url = images[task.mediaTool.image_index];
        if (!url) throw new Error("Select the source image on the canvas first.");
        toolInput = { image_url: url, ...(task.mediaTool.name === "upscale_image" ? { scale: task.mediaTool.scale } : {}), output_format: "png" };
      }
      // Keep submission alive until its ID arrives so Stop can cancel the actual job.
      const submitted = await request(provider, { model: task.model, signal: provider === "fal" ? AbortSignal.timeout(60_000) : signal, action: task.category === "video" ? "video" : "submit", input: toolInput ?? (task.category === "video" ? task.prompt : multi ? viewInput : imageInput ? { image_url: imageUrl } : { prompt: task.prompt }) }) as { id?: string; request_id?: string };
      requestId = task.category === "video" ? submitted.id : submitted.request_id;
      if (!requestId || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new Error("Provider returned no valid job ID");
      update({ requestId, status: "Queued" });
    }
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const result = await call({ action: task.category === "video" ? "video-status" : "status", requestId }) as { status?: string; urls?: string[] };
      const status = result.status?.toLowerCase();
      if (["failed", "cancelled", "expired"].includes(status ?? "")) throw new Error("Generation failed at the provider");
      if (status === "completed") {
        update({ status: "Loading result" });
        if (task.mediaTool) {
          if (task.mediaTool.name === "rig_3d") return rigFiles(await call({ action: "result", requestId }));
          if (task.mediaTool.name === "animate_3d") return animationFiles(await call({ action: "result", requestId }));
          const result = await call({ action: "result", requestId }) as { image?: { url?: string } };
          if (!safeMediaUrl(result.image?.url)) throw new Error("The image tool returned no supported image.");
          return [{ url: result.image.url, name: task.mediaTool.name === "remove_background" ? "Background removed" : `Upscaled ${task.mediaTool.name === "upscale_image" ? task.mediaTool.scale : 2}x`, kind: "image" }];
        }
        if (task.category === "3d") {
          const files = modelFiles(await call({ action: "result", requestId }));
          if (!files.length) throw new Error("The 3D model returned no downloadable files");
          return files;
        }
        const signed = result.urls?.[0];
        const url = safeMediaUrl(signed) ? signed : URL.createObjectURL(await call({ action: "video-content", requestId }) as Blob);
        return [{ url, name: "Video", kind: "video" }];
      }
      if (!["pending", "in_queue", "in_progress"].includes(status ?? "")) throw new Error("Provider returned an unknown job status");
      update({ status: status === "in_progress" ? "Generating" : "Queued" });
      await pause(task.category === "video" ? 15_000 : 5000, signal);
    }
    throw new Error("Still waiting. Use Check job to continue without generating again.");
  } catch (cause) {
    if (signal.aborted && provider === "fal" && requestId) {
      let result: { status?: string };
      try {
        result = await request(provider, { action: "cancel", model: task.model, requestId, signal: AbortSignal.timeout(15_000) }) as { status?: string };
      } catch {
        throw new Error("Could not confirm job cancellation. Check the provider dashboard; charges may apply.");
      }
      const message = result.status === "OK" ? "Job cancelled at provider."
        : result.status === "CANCELLATION_REQUESTED" ? "Provider received cancellation. Running work may take time to stop."
        : result.status === "ALREADY_COMPLETED" ? "Job already completed before cancellation; charges may apply."
        : "Could not confirm job cancellation. Check the provider dashboard; charges may apply.";
      throw new Error(message);
    }
    throw cause;
  }
}
