import assert from "node:assert/strict";
import test from "node:test";
import { processImage } from "./image-tools";

test("subject crops keep unequal bounds, labels and padding without stretching", async () => {
  const originalFetch = globalThis.fetch;
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const draws: number[][] = [];
  const sizes: number[][] = [];
  let closed = false;
  globalThis.fetch = (async () => new Response(new Blob())) as typeof fetch;
  globalThis.createImageBitmap = (async () => ({ width: 1000, height: 400, close() { closed = true; } })) as typeof createImageBitmap;
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, getContext() { return {
      translate() {}, rotate() {}, scale() {},
      drawImage(_image: unknown, ...args: number[]) { draws.push(args); },
    }; }, toDataURL() { sizes.push([canvas.width, canvas.height]); return "data:image/png;base64,YQ=="; } };
    return canvas;
  } } as unknown as Document;
  try {
    const files = await processImage({ image_index: 0, padding: 0.05, regions: [
      { x: 0.02, y: 0.1, width: 0.28, height: 0.8, label: "Front" },
      { x: 0.35, y: 0.1, width: 0.16, height: 0.8, label: "Right" },
    ] }, ["data:image/png;base64,YQ=="], new AbortController().signal);
    assert.deepEqual(files.map(f => f.name), ["Front", "Right"]);
    assert.deepEqual(draws.map(d => d.slice(0, 4)), [[20, 40, 280, 320], [350, 40, 160, 320]]);
    assert.deepEqual(sizes, [[312, 352], [192, 352]]);
    assert.deepEqual(draws.map(d => d.slice(6)), [[280, 320], [160, 320]]);
    draws.length = 0;
    await processImage({ image_index: 0, width: 200, height: 200, regions: [{ x: 0, y: 0, width: 1, height: 1 }] }, ["data:image/png;base64,YQ=="], new AbortController().signal);
    assert.deepEqual(draws[0].slice(4), [-100, -40, 200, 80]);
    assert.equal(closed, true);
    await assert.rejects(processImage({ image_index: 1, regions: [{ x: 0, y: 0, width: 1, height: 1 }] }, ["data:image/png;base64,YQ=="], new AbortController().signal), /Select the source/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalBitmap;
    globalThis.document = originalDocument;
  }
});
