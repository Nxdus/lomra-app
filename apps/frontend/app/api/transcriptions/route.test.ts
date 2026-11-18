import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("transcription validates uploads and calls Whisper directly", async () => {
  function request(file?: File) {
    const body = new FormData();
    if (file) body.append("file", file);
    return new Request("http://localhost/api/transcriptions", { method: "POST", body });
  }

  assert.equal((await POST(new Request("http://localhost/api/transcriptions", {
    method: "POST", body: "invalid multipart",
  }))).status, 400);
  assert.equal((await POST(request())).status, 400);
  assert.equal((await POST(request(new File([], "empty.wav")))).status, 400);
  assert.equal((await POST(request(new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.wav")))).status, 413);

  const originalFetch = globalThis.fetch;
  const file = new File(["audio bytes"], "recording.wav", { type: "audio/x-wav" });
  let forwardedUrl = "";
  let forwardedOptions: RequestInit | undefined;
  try {
    globalThis.fetch = (async (url, options) => {
      forwardedUrl = String(url);
      forwardedOptions = options;
      return Response.json({ text: "สวัสดี", language: "th" });
    }) as typeof fetch;
    assert.deepEqual(await (await POST(request(file))).json(), { text: "สวัสดี", language: "th" });
    assert.equal(forwardedUrl, new URL("/asr?task=transcribe&output=json", process.env.WHISPER_URL ?? "http://127.0.0.1:9000").href);
    assert.equal(forwardedOptions?.method, "POST");
    const uploaded = (forwardedOptions?.body as FormData).get("audio_file") as File;
    assert.equal(uploaded.type, file.type);
    assert.equal(await uploaded.text(), await file.text());

    globalThis.fetch = (async () => Response.json({ message: "Invalid audio" }, { status: 400 })) as typeof fetch;
    assert.equal((await POST(request(file))).status, 502);
    globalThis.fetch = (async () => Response.json({ text: 1 })) as typeof fetch;
    assert.equal((await POST(request(file))).status, 502);
    assert.equal((await POST(request(new File(["x"], "a.txt", { type: "text/plain" })))).status, 400);

    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await POST(request(file))).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
