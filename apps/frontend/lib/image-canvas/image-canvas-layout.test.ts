import assert from "node:assert/strict";
import test from "node:test";
import { fitCanvas, reorganizeCanvas } from "./image-canvas-layout";
import { parseCanvasCamera } from "./image-canvas-camera";

test("orders by position, wraps rows and preserves proportions, identity and stacking", () => {
  const items = [
    { id: "last", x: 0, y: 200, width: 100, height: 200 },
    { id: "right", x: 500, y: 0, width: 200, height: 100 },
    { id: "first", x: 0, y: 0, width: 100, height: 100 },
  ];
  const original = structuredClone(items);
  const result = reorganizeCanvas(items, 800);
  assert.deepEqual(result.map(item => item.id), items.map(item => item.id));
  assert.deepEqual(result.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 0, y: 264, width: 120, height: 240 },
    { x: 264, y: 0, width: 480, height: 240 },
    { x: 0, y: 0, width: 240, height: 240 },
  ]);
  assert.deepEqual(items, original);
});

test("very wide media fits a narrow viewport without distortion", () => {
  const [item] = reorganizeCanvas([{ id: "wide", x: 1, y: 1, width: 4000, height: 100 }], 320);
  assert.equal(item.width, 272);
  assert.equal(item.width / item.height, 40);
  assert.deepEqual(reorganizeCanvas([], 320), []);
});

test("fit includes every item even for canvases requiring zoom below 20%", () => {
  const items = [{ x: -100, y: -200, width: 1000, height: 10000 }];
  const camera = fitCanvas(items, 800, 600);
  assert.ok(camera.scale < 0.2);
  assert.deepEqual(parseCanvasCamera(JSON.stringify(camera)), camera);
  for (const item of items) {
    assert.ok(item.x * camera.scale + camera.x >= 24);
    assert.ok(item.y * camera.scale + camera.y >= 24);
    assert.ok((item.x + item.width) * camera.scale + camera.x <= 776);
    assert.ok((item.y + item.height) * camera.scale + camera.y <= 576);
  }
});
