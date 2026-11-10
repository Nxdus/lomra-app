import assert from "node:assert/strict";
import test from "node:test";
import { MAX_MEDIA_BYTES, promptContent } from "./media";

test("selected files become inline media, with GLB sent as a labeled preview", async () => {
  const signal = new AbortController().signal;
  assert.equal(await promptContent("hello", [], signal), "hello");
  const image = new File(["image-bytes"], "cat.png", { type: "image/png" });
  const video = new File(["video-bytes"], "cat.webm");
  const model = new File(["model-bytes"], "cat.glb");
  const content = await promptContent("describe", [{ id: "1", file: image }, { id: "2", file: video }, { id: "3", file: model }], signal, (id) => {
    assert.equal(id, "3");
    return "data:image/png;base64,cHJldmlldw==";
  });
  assert.deepEqual(content, [
    { type: "text", text: "describe" },
    { type: "text", text: "Attached image: cat.png (image_index=0)" },
    { type: "image_url", image_url: { url: `data:image/png;base64,${btoa("image-bytes")}` } },
    { type: "text", text: "Attached video: cat.webm (video_index=0)" },
    { type: "video_url", video_url: { url: `data:video/webm;base64,${btoa("video-bytes")}` } },
    { type: "text", text: "3D preview (current view only): cat.glb (model_index=0, image_index=1)" },
    { type: "image_url", image_url: { url: "data:image/png;base64,cHJldmlldw==" } },
  ]);
  await assert.rejects(promptContent("hello", Array.from({ length: 11 }, () => ({ id: "1", file: image })), signal), /at most 10/);
  const oversized = new File([new Uint8Array(MAX_MEDIA_BYTES + 1)], "large.mp4", { type: "video/mp4" });
  await assert.rejects(promptContent("hello", [{ id: "1", file: oversized }], signal), /20 MB/);
  await assert.rejects(promptContent("hello", [{ id: "1", file: model }], signal), /capture/);
  const stopped = AbortSignal.abort();
  await assert.rejects(promptContent("hello", [{ id: "1", file: image }], stopped));
});
