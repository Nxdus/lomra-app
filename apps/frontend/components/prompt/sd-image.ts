const maxSide = 1536;

async function load(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not load the selected picture.");
  const bitmap = await createImageBitmap(await response.blob());
  if (signal.aborted) { bitmap.close(); signal.throwIfAborted(); }
  return bitmap;
}

function surface(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = Math.max(1, Math.round(width));
  result.height = Math.max(1, Math.round(height));
  const context = result.getContext("2d");
  if (!context) throw new Error("Image editing is unavailable.");
  context.imageSmoothingQuality = "high";
  return { result, context };
}

/**
 * A picture as the local engine needs it: an upright, opaque PNG of a moderate size (the engine ignores rotation tags
 * and transparency). `aspectRatio` (`W:H`) takes the centre of that shape.
 */
export async function sdPicture(url: string, signal: AbortSignal, { aspectRatio, background = "#fff" }: { aspectRatio?: string; background?: string } = {}) {
  const bitmap = await load(url, signal);
  try {
    const shape = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio ?? "");
    const wanted = shape ? Number(shape[1]) / Number(shape[2]) : NaN;
    const ratio = wanted > 0 && Number.isFinite(wanted) ? wanted : bitmap.width / bitmap.height;
    const width = Math.min(bitmap.width, bitmap.height * ratio), height = Math.min(bitmap.height, bitmap.width / ratio);
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const { result, context } = surface(width * scale, height * scale);
    context.fillStyle = background;
    context.fillRect(0, 0, result.width, result.height);
    context.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - height) / 2, width, height, 0, 0, result.width, result.height);
    return { url: result.toDataURL("image/png"), ratio: width / height };
  } finally { bitmap.close(); }
}

/** Stretches a result back to the shape of the picture it was made from, because the engine rounds sizes to 64 pixels. */
export async function restoreRatio(url: string, ratio: number, signal: AbortSignal) {
  const bitmap = await load(url, signal);
  try {
    const { result, context } = surface(Math.min(bitmap.width, bitmap.height * ratio), Math.min(bitmap.height, bitmap.width / ratio));
    if (result.width === bitmap.width && result.height === bitmap.height) return url;
    context.drawImage(bitmap, 0, 0, result.width, result.height);
    return result.toDataURL("image/png");
  } finally { bitmap.close(); }
}
