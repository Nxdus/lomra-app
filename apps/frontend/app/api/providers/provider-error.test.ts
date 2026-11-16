import assert from "node:assert/strict";
import test from "node:test";
import { falErrorMessage } from "./provider-error";
import { POST } from "./route";

test("Fal error details include stage and status without exposing files or credentials", async () => {
  const message = await falErrorMessage(Response.json({ detail: [{ msg: "Cannot rig model: clearly defined limbs required" }, { msg: "key-id:secret-value https://fal.media/model?token=private data:model/gltf-binary;base64,Z2xURgIA" }] }, { status: 422 }), "result", "key-id:secret-value");
  assert.match(message, /Fal result failed \(HTTP 422\): Cannot rig model/);
  assert.doesNotMatch(message, /key-id|secret-value|token=private|Z2xURgIA/);
  assert.match(await falErrorMessage(new Response("upstream unavailable", { status: 503 }), "status", "test-key"), /HTTP 503/);
});

test("checking an existing Meshy job preserves provider failure details and never resubmits", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      assert.equal(String(url), "https://queue.fal.run/fal-ai/meshy/requests/existing-job");
      assert.equal(options?.method, "GET");
      return Response.json({ detail: "Failed to download model" }, { status: 422 });
    }) as typeof fetch;
    const response = await POST(new Request("http://localhost/api/providers", { method: "POST", headers: { "x-api-key": "test-key" }, body: JSON.stringify({ provider: "fal", action: "result", model: "fal-ai/meshy/rigging", requestId: "existing-job" }) }));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { message: "Fal result failed (HTTP 422): Failed to download model" });
  } finally { globalThis.fetch = originalFetch; }
});
