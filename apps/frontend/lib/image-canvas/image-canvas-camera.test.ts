import assert from "node:assert/strict";
import test from "node:test";
import { canvasPoint, parseCanvasCamera, zoomCamera } from "./image-canvas-camera";

test("saved camera restores valid views and safely rejects malformed or out-of-range data", () => {
  const saved = { x: -123.5, y: 234.25, scale: 1.5625 };
  assert.deepEqual(parseCanvasCamera(JSON.stringify(saved)), saved);
  for (const value of [null, "invalid", "null", "{}", '{"x":"1","y":0,"scale":1}', '{"x":1e400,"y":0,"scale":1}', '{"x":0,"y":0,"scale":0}', '{"x":0,"y":0,"scale":5}']) {
    assert.deepEqual(parseCanvasCamera(value), { x: 0, y: 0, scale: 1 });
  }
});

test("camera maps drop, paste and drag positions after pan and zoom", () => {
  const camera = { x: 100, y: -50, scale: 2 };
  assert.deepEqual(canvasPoint(camera, 300, 150), { x: 100, y: 100 });
  assert.deepEqual(canvasPoint(camera, 0, 0), { x: -50, y: 25 });
  const before = canvasPoint(camera, 300, 150);
  const after = canvasPoint(camera, 340, 170);
  assert.deepEqual({ x: after.x - before.x, y: after.y - before.y }, { x: 20, y: 10 });
});

test("zoom preserves the world point under the cursor, including at scale limits", () => {
  const camera = { x: -120, y: 70, scale: 0.5 };
  const anchor = canvasPoint(camera, 200, 150);
  for (const scale of [0.01, 0.2, 1, 2, 4, 10]) {
    const next = zoomCamera(camera, scale, 200, 150);
    assert.equal(next.scale, Math.max(0.2, Math.min(4, scale)));
    assert.deepEqual(canvasPoint(next, 200, 150), anchor);
  }
});
