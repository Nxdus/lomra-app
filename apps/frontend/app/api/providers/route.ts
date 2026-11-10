import { chatCompletion } from "./chat-stream";
import { MAX_MEDIA_BYTES, MAX_MEDIA_ITEMS } from "@/components/prompt/media";
import { generationPlan, generationTools, routingInstruction } from "./generation-tools";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ message: "Cross-origin requests are not allowed" }, 403);
  }
  const key = request.headers.get("x-api-key")?.trim();
  if (!key || key.length > 512 || /[^\x21-\x7e]/.test(key)) {
    return json({ message: "Enter a valid API key in Settings" }, 400);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Expected JSON" }, 400);
  }
  if (!body || typeof body !== "object") return json({ message: "Invalid request" }, 400);
  const { provider, action, model, input, requestId, images } = body;
  if (provider !== "openrouter" && provider !== "fal") {
    return json({ message: "Unknown provider" }, 400);
  }
  let url: string;
  let payload: unknown;
  if (action === "usage") {
    const falKeyId = key.split(":")[0];
    if (provider === "fal" && (!falKeyId || !key.includes(":") || !key.split(":")[1])) {
      return json({ message: "Enter a Fal API key in key_id:key_secret format" }, 400);
    }
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    url = provider === "openrouter"
      ? "https://openrouter.ai/api/v1/key"
      : `https://api.fal.ai/v1/models/usage?expand=summary&start=${start.toISOString()}&end=${new Date().toISOString()}&bound_to_timeframe=false&api_key_id=${encodeURIComponent(falKeyId)}`;
  } else if (action === "credits" && provider === "fal") {
    url = "https://api.fal.ai/v1/account/billing?expand=credits";
  } else if (action === "verify") {
    url = provider === "openrouter"
      ? "https://openrouter.ai/api/v1/key"
      : "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev";
  } else {
    if (typeof model !== "string" || model.length > 200 ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.:-]+)+$/.test(model) ||
      model.split("/").some((part: string) => part === "." || part === "..")) {
      return json({ message: "A valid model ID is required" }, 400);
    }
    if (provider === "openrouter" && (action === "chat" || action === "route")) {
      let mediaCount = 0;
      let mediaBytes = 0;
      const textLimit = action === "route" ? 8000 : 100_000;
      const validContent = (content: unknown, role: string) => {
        if (typeof content === "string") return content.length <= textLimit;
        if (role !== "user" || !Array.isArray(content) || !content.length || content.length > MAX_MEDIA_ITEMS * 2 + 1) return false;
        let textLength = 0;
        return content.every((part: unknown) => {
          if (!part || typeof part !== "object" || !("type" in part)) return false;
          if (part.type === "text") {
            if (!("text" in part) || typeof part.text !== "string") return false;
            textLength += part.text.length;
            return part.text.length <= textLimit && textLength <= textLimit + MAX_MEDIA_ITEMS * 300;
          }
          const value = part.type === "image_url" && "image_url" in part ? part.image_url : part.type === "video_url" && "video_url" in part ? part.video_url : null;
          if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") return false;
          const pattern = part.type === "image_url" ? /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/ : /^data:video\/(mp4|webm);base64,([A-Za-z0-9+/]+={0,2})$/;
          const match = pattern.exec(value.url);
          if (!match || match[2].length % 4 !== 0) return false;
          mediaCount++;
          mediaBytes += match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
          return mediaCount <= MAX_MEDIA_ITEMS && mediaBytes <= MAX_MEDIA_BYTES;
        });
      };
      if (!Array.isArray(input) || !input.length || input.length > (action === "route" ? 21 : 100) || input.some(
        (message: unknown) => !message || typeof message !== "object" ||
          !("role" in message) || !["system", "user", "assistant"].includes(String(message.role)) ||
          (action === "route" && message.role === "system") ||
          !("content" in message) || !validContent(message.content, String(message.role)),
      )) return json({ message: "Valid chat messages are required (up to 10 media items, 20 MB total)" }, 400);
      url = "https://openrouter.ai/api/v1/chat/completions";
      payload = { model, messages: input, stream: true };
      if (action === "route") {
        payload = { model, messages: [{ role: "system", content: routingInstruction }, ...input],
          modalities: ["text"], provider: { require_parameters: true },
          tools: generationTools, tool_choice: "auto", stream: true };
      }
    } else if (provider === "openrouter" && (action === "image" || action === "video")) {
      if (typeof input !== "string" || !input.trim() || input.length > 8000) return json({ message: "A generation prompt is required" }, 400);
      url = `https://openrouter.ai/api/v1/${action === "image" ? "images" : "videos"}`;
      if (images !== undefined && (action !== "image" || !Array.isArray(images) || images.length > MAX_MEDIA_ITEMS ||
        images.some((url: unknown) => typeof url !== "string" || !/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.test(url) || url.split(",")[1].length % 4 !== 0) ||
        images.reduce((sum: number, url: string) => sum + url.length, 0) > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + MAX_MEDIA_ITEMS * 64)) return json({ message: "Invalid reference images (up to 10 images, 20 MB total)" }, 400);
      payload = { model, prompt: input, ...(images?.length ? { input_references: images.map((url: string) => ({ type: "image_url", image_url: { url } })) } : {}) };
    } else if (provider === "openrouter" && (action === "video-status" || action === "video-content")) {
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) return json({ message: "A valid request ID is required" }, 400);
      url = `https://openrouter.ai/api/v1/videos/${requestId}${action === "video-content" ? "/content" : ""}`;
    } else if (provider === "fal" && action === "submit") {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return json({ message: "Model input is required" }, 400);
      }
      url = `https://queue.fal.run/${model}`;
      payload = input;
    } else if (provider === "fal" && (action === "status" || action === "result" || action === "cancel")) {
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) {
        return json({ message: "A valid request ID is required" }, 400);
      }
      // Queue lookups use owner/app, even when submission uses a model subpath.
      url = `https://queue.fal.run/${model.split("/").slice(0, 2).join("/")}/requests/${requestId}${action === "status" ? "/status" : action === "cancel" ? "/cancel" : ""}`;
    } else return json({ message: "Unsupported provider action" }, 400);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(action === "image" ? 180_000 : 60_000)]);
  try {
    const usageUrl = url;
    let total = 0;
    const cursors = new Set<string>();
    do {
      const response = await fetch(url, {
        method: action === "cancel" ? "PUT" : payload === undefined ? "GET" : "POST",
        headers: {
          Authorization: `${provider === "openrouter" ? "Bearer" : "Key"} ${key}`,
          "Content-Type": "application/json",
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal, cache: "no-store", redirect: "error",
      });
      if (!response.ok) {
        const status = response.status;
        const message = status === 401 ? "API key was rejected" :
          status === 403 ? (provider === "fal" && (action === "usage" || action === "credits")
            ? "Credit usage requires a Fal key with billing permissions. Check usage in the Fal dashboard or update this key's permissions."
            : "This key does not have permission for this operation") :
          status === 402 ? "Insufficient provider credits" :
          status === 429 ? "Provider rate limit reached. Try again later" :
          "Provider could not complete the request";
        return json({ message }, [400, 401, 402, 403, 404, 422, 429].includes(status) ? status : 502);
      }
      if (action === "video-content") {
        return new Response(response.body, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" } });
      }
      const result: unknown = provider === "openrouter" && (action === "chat" || action === "route") && response.headers.get("content-type")?.includes("text/event-stream")
        ? await chatCompletion(response) : await response.json();
      if (!result || typeof result !== "object" || ("error" in result && result.error)) {
        return json({ message: "Provider returned an invalid response" }, 502);
      }
      if (action === "route") {
        try { return json(generationPlan(result)); }
        catch { return json({ message: "LLM returned an invalid tool call. Try again or choose another LLM." }, 502); }
      }
      const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
      if (action === "credits") {
        const credits = "credits" in result ? result.credits : null;
        if (!credits || typeof credits !== "object" || !("current_balance" in credits) ||
          !amount(credits.current_balance) || !("currency" in credits) || credits.currency !== "USD") {
          return json({ message: "Provider returned invalid credit data" }, 502);
        }
        return json({ metrics: [{ label: "Account balance", amount: credits.current_balance }] });
      }
      if (action === "usage" && provider === "openrouter") {
        const data = "data" in result ? result.data : null;
        if (!data || typeof data !== "object" || !("usage" in data) || !amount(data.usage)) {
          return json({ message: "Provider returned invalid usage data" }, 502);
        }
        const metrics = [{ label: "Key usage · All time", amount: data.usage }];
        if ("usage_monthly" in data && amount(data.usage_monthly)) metrics.push({ label: "Key usage · This month", amount: data.usage_monthly });
        if ("limit_remaining" in data && amount(data.limit_remaining)) metrics.push({ label: "Key limit remaining", amount: data.limit_remaining });
        return json({ metrics });
      }
      if (action === "usage" && provider === "fal") {
        if (!("summary" in result) || !Array.isArray(result.summary)) {
          return json({ message: "Provider returned invalid usage data" }, 502);
        }
        for (const row of result.summary) {
          if (!row || !amount(row.cost_total) || row.currency !== "USD") {
            return json({ message: "Provider returned invalid usage data" }, 502);
          }
          total += row.cost_total;
        }
        if ("has_more" in result && result.has_more === false && amount(total)) {
          return json({ metrics: [{ label: "Key usage · This month", amount: total }] });
        }
        const cursor = "next_cursor" in result ? result.next_cursor : null;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor) || cursors.size >= 100) {
          return json({ message: "Could not load complete usage. Check the Fal dashboard." }, 502);
        }
        cursors.add(cursor);
        url = `${usageUrl}&cursor=${encodeURIComponent(cursor)}`;
        continue;
      }
      return json(action === "verify" ? { connected: true } : result);
    } while (!signal.aborted);
    return json({ message: "Provider request timed out" }, 504);
  } catch {
    return json({ message: signal.aborted ? "Provider request timed out" : "Provider is unavailable" }, signal.aborted ? 504 : 502);
  }
}
