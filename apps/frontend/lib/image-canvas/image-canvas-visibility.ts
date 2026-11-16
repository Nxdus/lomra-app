import type { CanvasCamera } from "./image-canvas-camera";
import type { ImageBounds } from "./image-canvas-resize";

export function canvasMediaVisible(bounds: ImageBounds, camera: CanvasCamera, viewport: { width: number; height: number }, mounted: boolean) {
  if (viewport.width <= 0 || viewport.height <= 0) return false;
  // Screen-pixel margins keep preloading consistent at every zoom level.
  const margin = mounted ? 500 : 200;
  const left = bounds.x * camera.scale + camera.x;
  const top = bounds.y * camera.scale + camera.y;
  return left <= viewport.width + margin && top <= viewport.height + margin &&
    left + bounds.width * camera.scale >= -margin && top + bounds.height * camera.scale >= -margin;
}
