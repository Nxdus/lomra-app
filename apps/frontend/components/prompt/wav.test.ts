import assert from "node:assert/strict";
import test from "node:test";
import { encodeWav } from "./wav";

test("encodeWav writes a 16-bit mono WAV with clamped samples", async () => {
  const bytes = new Uint8Array(await encodeWav(new Float32Array([0.5, -1, 2]), 16000).arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([44, 46, 48].map((at) => view.getInt16(at, true)), [16384, -32767, 32767]);
});
