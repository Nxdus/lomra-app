import assert from "node:assert/strict";
import test from "node:test";
import { canvasMediaVisible } from "./image-canvas-visibility";

const viewport = { width: 800, height: 600 };
const camera = { x: 0, y: 0, scale: 1 };
const bounds = { x: 1050, y: 0, width: 320, height: 320 };

test("preloads nearby media and retains it in the wider unload margin", () => {
  assert.equal(canvasMediaVisible({ ...bounds, x: 990 }, camera, viewport, false), true);
  assert.equal(canvasMediaVisible(bounds, camera, viewport, false), false);
  assert.equal(canvasMediaVisible(bounds, camera, viewport, true), true);
  assert.equal(canvasMediaVisible({ ...bounds, x: 1301 }, camera, viewport, true), false);
});

test("uses transformed bounds for pan, zoom, negative positions and resize", () => {
  assert.equal(canvasMediaVisible(bounds, { x: -1000, y: 0, scale: 1 }, viewport, false), true);
  assert.equal(canvasMediaVisible(bounds, { x: 0, y: 0, scale: 0.5 }, viewport, false), true);
  assert.equal(canvasMediaVisible({ ...bounds, x: -600 }, camera, viewport, false), false);
  assert.equal(canvasMediaVisible({ ...bounds, x: -600, width: 450 }, camera, viewport, false), true);
  assert.equal(canvasMediaVisible({ ...bounds, x: 0, y: 801 }, camera, viewport, false), false);
  assert.equal(canvasMediaVisible(bounds, camera, { width: 1200, height: 600 }, false), true);
  assert.equal(canvasMediaVisible(bounds, camera, { width: 0, height: 0 }, true), false);
});
