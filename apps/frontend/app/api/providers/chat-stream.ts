// Assemble streamed tool calls so disconnecting can cancel upstream generation.
export async function chatCompletion(response: Response) {
  if (!response.body) throw new Error("Missing chat stream");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let content = "";
  let done = false;
  const calls = new Map<number, { type: string; function: { name: string; arguments: string } }>();
  function line(value: string) {
    if (!value.startsWith("data:")) return;
    const data = value.slice(5).trim();
    if (data === "[DONE]") { done = true; return; }
    if (!data) return;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error("Chat stream failed");
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string") content += delta.content;
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 3) throw new Error("Invalid tool call index");
      const call = calls.get(part.index) ?? { type: "function", function: { name: "", arguments: "" } };
      call.function.name += part.function?.name ?? "";
      call.function.arguments += part.function?.arguments ?? "";
      calls.set(part.index, call);
    }
  }
  try {
    while (!done) {
      const next = await reader.read();
      if (next.done) break;
      buffer += next.value;
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        line(buffer.slice(0, end).trimEnd());
        buffer = buffer.slice(end + 1);
      }
    }
    if (buffer) line(buffer.trimEnd());
    if (!done) throw new Error("Incomplete chat stream");
    return { choices: [{ message: { role: "assistant", content, tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } }] };
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
