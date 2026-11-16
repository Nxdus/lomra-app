import type { ImageBounds } from "./image-canvas-resize";
import type { CanvasCamera } from "./image-canvas-camera";

export function reorganizeCanvas<T extends ImageBounds & { id: string }>(items: T[], viewportWidth: number) {
  const rowWidth = Math.max(1, viewportWidth - 48);
  const positions = new Map<string, ImageBounds>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const ratio = item.width / item.height;
    const height = Math.min(240, rowWidth / ratio);
    const width = height * ratio;
    if (x > 0 && x + width > rowWidth) {
      x = 0;
      y += rowHeight + 24;
      rowHeight = 0;
    }
    positions.set(item.id, { x, y, width, height });
    x += width + 24;
    rowHeight = Math.max(rowHeight, height);
  }
  // Preserve array order: it controls stacking, independently of reading order.
  return items.map(item => ({ ...item, ...positions.get(item.id)! }));
}

export function fitCanvas(items: ImageBounds[], width: number, height: number): CanvasCamera {
  if (!items.length) return { x: 0, y: 0, scale: 1 };
  const left = Math.min(...items.map(item => item.x));
  const top = Math.min(...items.map(item => item.y));
  const right = Math.max(...items.map(item => item.x + item.width));
  const bottom = Math.max(...items.map(item => item.y + item.height));
  const scale = Math.min(1, Math.max(1, width - 48) / (right - left), Math.max(1, height - 48) / (bottom - top));
  return { x: (width - (right - left) * scale) / 2 - left * scale, y: (height - (bottom - top) * scale) / 2 - top * scale, scale };
}
