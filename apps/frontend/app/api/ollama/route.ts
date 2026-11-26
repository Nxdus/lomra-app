import { isRemoteOllama } from "@/lib/ollama-url";
import { sameOrigin } from "../same-origin";
import { OLLAMA_OFFLINE, ollamaCapabilities, ollamaUrl, validOllamaName } from "./ollama";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

type Tag = { name?: unknown; size?: unknown };

/** Installed models with what each can do. Chat here needs tools, so that is reported per model. */
export async function GET() {
  const base = await ollamaUrl();
  const server = { url: base, remote: isRemoteOllama(base) };
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000), cache: "no-store", redirect: "error" });
    const result: unknown = response.ok ? await response.json() : null;
    const tags = result && typeof result === "object" && "models" in result && Array.isArray(result.models) ? result.models as Tag[] : null;
    if (!tags) return json({ ...server, running: false, models: [] });
    const models = await Promise.all(tags.flatMap((tag) => typeof tag?.name === "string" && validOllamaName(tag.name) ? [{ name: tag.name, size: Number(tag.size) }] : []).map(async ({ name, size }) => {
      const known = await ollamaCapabilities(base, name);
      // Without capability data, assume the model works and let the first request report otherwise.
      return { id: name, size: Number.isFinite(size) ? size : 0, tools: known ? known.includes("tools") : true, vision: !!known?.includes("vision"), embedding: !!known && !known.includes("completion") };
    }));
    return json({ ...server, running: true, models: models.filter((model) => !model.embedding).map(({ id, size, tools, vision }) => ({ id, size, tools, vision })) });
  } catch {
    return json({ ...server, running: false, models: [] });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ message: "Cross-origin requests are not allowed" }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ message: "Expected JSON" }, 400); }
  const { action, model } = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if ((action !== "pull" && action !== "delete") || !validOllamaName(model)) return json({ message: "A valid action and model name are required" }, 400);
  try {
    // A pull is streamed as progress lines; aborting the request stops the download, and a later pull resumes it.
    const response = await fetch(`${await ollamaUrl()}/api/${action}`, {
      method: action === "pull" ? "POST" : "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "pull" ? { model, stream: true } : { model }),
      signal: action === "pull" ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      cache: "no-store", redirect: "error",
    });
    if (!response.ok) return json({ message: response.status === 404 ? "Model not found" : "Ollama could not complete the request" }, response.status === 404 ? 404 : 502);
    if (action === "delete") return json({ deleted: true });
    return new Response(response.body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  } catch {
    return json({ message: request.signal.aborted ? "Request stopped" : OLLAMA_OFFLINE }, 502);
  }
}
