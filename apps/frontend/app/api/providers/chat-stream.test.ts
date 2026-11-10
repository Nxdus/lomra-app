import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletion } from "./chat-stream";

test("chat stream assembles split text/tool arguments and rejects truncated streams", async () => {
  // Split JSON events across arbitrary network chunks, including UTF-8 text.
  const events = [
    { choices: [{ delta: { content: "สวัสดี", tool_calls: [{ index: 0, function: { name: "generate_3d", arguments: '{"prompt":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"cat"}' } }] } }] },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(events);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } });
  const result = await chatCompletion(new Response(stream));
  assert.equal(result.choices[0].message.content, "สวัสดี");
  assert.deepEqual(result.choices[0].message.tool_calls[0].function, { name: "generate_3d", arguments: '{"prompt":"cat"}' });
  await assert.rejects(chatCompletion(new Response(events.replace("data: [DONE]", ": truncated"))), /Incomplete/);
});
