export type CanvasCamera = { x: number; y: number; scale: number };
export const CANVAS_CAMERA_KEY = "lomra-canvas-camera";

export function parseCanvasCamera(value: string | null): CanvasCamera {
  try {
    const camera = JSON.parse(value ?? "null");
    if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y) &&
      Number.isFinite(camera.scale) && camera.scale > 0 && camera.scale <= 4) {
      return { x: camera.x, y: camera.y, scale: camera.scale };
    }
  } catch { /* Invalid saved views fall back to the default camera. */ }
  return { x: 0, y: 0, scale: 1 };
}

export function canvasPoint(camera: CanvasCamera, x: number, y: number) {
  return { x: (x - camera.x) / camera.scale, y: (y - camera.y) / camera.scale };
}

export function zoomCamera(camera: CanvasCamera, scale: number, x: number, y: number): CanvasCamera {
  const nextScale = Math.max(0.2, Math.min(4, scale));
  const anchor = canvasPoint(camera, x, y);
  return { x: x - anchor.x * nextScale, y: y - anchor.y * nextScale, scale: nextScale };
}
