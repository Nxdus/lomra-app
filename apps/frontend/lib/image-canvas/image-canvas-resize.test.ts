import assert from "node:assert/strict";
import test from "node:test";
import { resizeImage, type ImageCorner } from "./image-canvas-resize";

test("all corners resize proportionally and keep the opposite corner fixed", () => {
  const image = { x: 100, y: 80, width: 320, height: 160 };
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as ImageCorner[]) {
    const left = corner.endsWith("left");
    const top = corner.startsWith("top");
    const resized = resizeImage(image, corner, left ? -160 : 160, top ? -80 : 80);
    assert.equal(resized.width, 480);
    assert.equal(resized.height, 240);
    assert.equal(resized.x + (left ? resized.width : 0), image.x + (left ? image.width : 0));
    assert.equal(resized.y + (top ? resized.height : 0), image.y + (top ? image.height : 0));
  }
});

test("shrinking and crossing the anchor never flips or distorts the image", () => {
  const image = { x: -100, y: -80, width: 160, height: 320 };
  const smaller = resizeImage(image, "bottom-right", -80, -160);
  assert.deepEqual(smaller, { x: -100, y: -80, width: 80, height: 160 });
  const minimum = resizeImage(image, "top-left", 10000, 10000);
  assert.equal(minimum.width, 24);
  assert.equal(minimum.height, 48);
  assert.equal(minimum.x + minimum.width, 60);
  assert.equal(minimum.y + minimum.height, 240);
  const tiny = { x: 0, y: 0, width: 8, height: 4 };
  assert.deepEqual(resizeImage(tiny, "bottom-right", 0, 0), tiny);
});
