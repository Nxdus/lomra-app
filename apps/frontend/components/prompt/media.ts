import { canvasFileKind } from "@/lib/image-canvas/image-canvas-storage";

export type MediaPart = { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

// Keep inline uploads bounded; large-video uploads need a provider file-upload flow.
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_ITEMS = 10;

export async function promptContent(
  prompt: string, selection: { id: string; file: File }[], signal: AbortSignal,
  modelPreview?: (id: string) => string,
): Promise<string | MediaPart[]> {
  if (!selection.length) return prompt;
  if (selection.length > MAX_MEDIA_ITEMS) throw new Error("Select at most 10 media items per prompt.");
  if (selection.reduce((sum, item) => sum + (canvasFileKind(item.file) === "3d" ? 0 : item.file.size), 0) > MAX_MEDIA_BYTES) {
    throw new Error("Selected media exceeds 20 MB. Select fewer or smaller files.");
  }
  const parts: MediaPart[] = [{ type: "text", text: prompt }];
  let encodedSize = 0;
  let imageIndex = 0, videoIndex = 0, modelIndex = 0;
  for (const item of selection) {
    signal.throwIfAborted();
    const kind = canvasFileKind(item.file);
    let url: string;
    if (kind === "3d") {
      if (!modelPreview) throw new Error("Could not capture the selected 3D model.");
      url = modelPreview(item.id);
    } else {
      if (kind !== "image" && kind !== "video") throw new Error("Unsupported selected media.");
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      signal.throwIfAborted();
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      const mime = kind === "video" ? (/\.webm$/i.test(item.file.name) || item.file.type === "video/webm" ? "video/webm" : "video/mp4") : item.file.type;
      url = `data:${mime};base64,${btoa(binary)}`;
    }
    encodedSize += url.length;
    if (encodedSize > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + MAX_MEDIA_ITEMS * 64) throw new Error("Selected media exceeds 20 MB. Select fewer or smaller files.");
    const indexLabel = kind === "video" ? `video_index=${videoIndex++}` : kind === "3d" ? `model_index=${modelIndex++}, image_index=${imageIndex++}` : `image_index=${imageIndex++}`;
    parts.push({ type: "text", text: `${kind === "3d" ? "3D preview (current view only)" : `Attached ${kind}`}: ${item.file.name.slice(0, 200)} (${indexLabel})` });
    parts.push(kind === "video" ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } });
  }
  return parts;
}
