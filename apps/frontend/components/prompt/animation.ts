import { MAX_MEDIA_BYTES } from "./media";
import { canvasFileKind } from "@/lib/image-canvas/image-canvas-storage";
import type { MediaTool, ToolSource } from "./media-tools";
import type { GeneratedFile } from "./generation";

// Meshy library presets: https://docs.meshy.ai/en/api/animation-library
const actions = { idle: 0, walk: 30, run: 14, wave: 28, dance: 22 };

export async function animationInput(tool: Extract<MediaTool, { name: "animate_3d" | "rig_3d" }>, sources: ToolSource[], signal: AbortSignal) {
  const source = sources.filter(s => canvasFileKind(s.file) === "3d")[tool.model_index];
  if (!source) throw new Error("Select a humanoid GLB model on the canvas first.");
  if (source.file.size > MAX_MEDIA_BYTES) throw new Error("Animation supports GLB files up to 20 MB.");
  signal.throwIfAborted();
  const bytes = new Uint8Array(await source.file.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.length < 12 || new DataView(bytes.buffer).getUint32(0, true) !== 0x46546c67) throw new Error("Animation requires a valid GLB model.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const animation = tool.name === "animate_3d" ? tool : undefined;
  return { model_url: `data:model/gltf-binary;base64,${btoa(binary)}`, enable_animation: !!animation && !animation.motion_prompt, ...(animation?.animation ? { animation_action_id: actions[animation.animation] } : {}) };
}

export function animationFiles(result: unknown): GeneratedFile[] {
  const data = result as { animation_glb?: { url?: string }; animation_fbx?: { url?: string } };
  const files: GeneratedFile[] = [];
  for (const [name, file] of [["GLB", data?.animation_glb], ["FBX", data?.animation_fbx]] as const) {
    try { if (file?.url && new URL(file.url).protocol === "https:") files.push({ url: file.url, name, kind: "file" }); } catch { /* Ignore invalid provider URLs. */ }
  }
  if (!files.some(file => file.name === "GLB")) throw new Error("The animation provider returned no animated GLB.");
  return files;
}

export function rigFiles(result: unknown): GeneratedFile[] {
  const data = result as { rigged_character_glb?: { url?: string }; rigged_character_fbx?: { url?: string } };
  const files: GeneratedFile[] = [];
  for (const [name, file] of [["GLB", data?.rigged_character_glb], ["FBX", data?.rigged_character_fbx]] as const) {
    try { if (file?.url && new URL(file.url).protocol === "https:") files.push({ url: file.url, name, kind: "file" }); } catch { /* Ignore invalid provider URLs. */ }
  }
  if (!files.some(file => file.name === "GLB")) throw new Error("The rigging provider returned no rigged GLB.");
  return files;
}
