// Local image operations preserve the source; coordinates are normalized to 0..1.
export type ImageOperation = {
  image_index: number;
  regions: { x: number; y: number; width: number; height: number; label?: string }[];
  padding?: number;
  width?: number; height?: number; rotate?: number; flip?: boolean;
};
export function validateImageOperation(value: unknown): asserts value is ImageOperation {
  const op = value as ImageOperation;
  if (!op || !Number.isInteger(op.image_index) || op.image_index < 0 || op.image_index > 9 ||
      !Array.isArray(op.regions) || !op.regions.length || op.regions.length > 16 ||
      op.regions.some(r => !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001 || (r.label !== undefined && (typeof r.label !== "string" || r.label.length > 80))) ||
      (op.padding !== undefined && (!Number.isFinite(op.padding) || op.padding < 0 || op.padding > 0.5)) ||
      [op.width, op.height].some(n => n !== undefined && (!Number.isInteger(n) || n < 1 || n > 8192)) ||
      (op.rotate !== undefined && ![0, 90, 180, 270].includes(op.rotate)) ||
      (op.flip !== undefined && typeof op.flip !== "boolean")) throw new Error("Invalid image operation");
}
export async function processImage(op: ImageOperation, images: string[], signal: AbortSignal) {
  validateImageOperation(op);
  signal.throwIfAborted();
  const url = images[op.image_index];
  if (!url) throw new Error("Select the source image on the canvas first.");
  const source = await createImageBitmap(await (await fetch(url, { signal })).blob());
  try {
    const files = [];
    for (const [index, region] of op.regions.entries()) {
      signal.throwIfAborted();
      const x = Math.round(region.x * source.width), y = Math.round(region.y * source.height);
      const w = Math.min(source.width, Math.round((region.x + region.width) * source.width)) - x;
      const h = Math.min(source.height, Math.round((region.y + region.height) * source.height)) - y;
      if (w < 1 || h < 1) throw new Error("Crop region is smaller than one pixel.");
      const margin = Math.round(Math.max(w, h) * (op.padding ?? 0));
      const paddedWidth = w + margin * 2, paddedHeight = h + margin * 2;
      const width = op.width ?? (op.height ? Math.round(paddedWidth * op.height / paddedHeight) : paddedWidth);
      const height = op.height ?? (op.width ? Math.round(paddedHeight * op.width / paddedWidth) : paddedHeight);
      const scale = Math.min(width / paddedWidth, height / paddedHeight);
      const drawWidth = w * scale, drawHeight = h * scale;
      if (width < 1 || height < 1 || width * height > 32_000_000 || width > 8192 || height > 8192) throw new Error("Output image is too large or too small.");
      const canvas = document.createElement("canvas");
      const turn = op.rotate === 90 || op.rotate === 270;
      canvas.width = turn ? height : width; canvas.height = turn ? width : height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image processing is unavailable.");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((op.rotate ?? 0) * Math.PI / 180);
      ctx.scale(op.flip ? -1 : 1, 1);
      ctx.drawImage(source, x, y, w, h, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      files.push({ url: canvas.toDataURL("image/png"), name: region.label?.trim() || `Image ${index + 1}`, kind: "image" as const });
      canvas.width = canvas.height = 0;
    }
    return files;
  } finally { source.close(); }
}
