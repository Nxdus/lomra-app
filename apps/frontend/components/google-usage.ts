import { getSetting, saveSetting } from "@/lib/settings";

/** Google AI Studio has no usage API for an API key, so Lomra counts what it sends this month (UTC). */
export type GoogleUsage = { month: string; requests: number; inputTokens: number; outputTokens: number };

const currentMonth = () => new Date().toISOString().slice(0, 7);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
let queue: Promise<unknown> = Promise.resolve();

export async function readGoogleUsage(): Promise<GoogleUsage> {
  const saved = await getSetting<GoogleUsage>("google-usage");
  return saved?.month === currentMonth() ? saved : { month: currentMonth(), requests: 0, inputTokens: 0, outputTokens: 0 };
}

/** Add one finished Google request. Calls are queued so parallel requests do not overwrite each other. */
export function recordGoogleUsage(action: string, result: unknown) {
  if (!["chat", "route", "image"].includes(action)) return;
  const usage = (result as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage;
  queue = queue.then(async () => {
    const current = await readGoogleUsage();
    await saveSetting("google-usage", { month: current.month, requests: current.requests + 1, inputTokens: current.inputTokens + count(usage?.prompt_tokens), outputTokens: current.outputTokens + count(usage?.completion_tokens) });
  }).catch(() => {});
}
