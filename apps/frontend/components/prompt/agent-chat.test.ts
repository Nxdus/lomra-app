// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { expect, test } from "bun:test";
import type { AgentChatEvent } from "@/lib/desktop";
import { localAgentModel, runAgentChat } from "./agent-chat";

test("reads saved CLI defaults and explicit models without matching API models", () => {
  expect(localAgentModel("local-agent/claude")).toEqual({ engine: "claude", modelId: undefined });
  expect(localAgentModel("local-agent/codex/gpt-6.2-sol")).toEqual({ engine: "codex", modelId: "gpt-6.2-sol" });
  expect(localAgentModel("openai/gpt-6.2-sol")).toBeUndefined();
});

function install(script: (emit: (event: AgentChatEvent) => void) => void) {
  let listener: (message: { runId: string; event: AgentChatEvent }) => void = () => {};
  const cancelled: string[] = [];
  (globalThis as unknown as { window: unknown }).window = { lomra: { agent: {
    onChat: (callback: typeof listener) => { listener = callback; return () => { listener = () => {}; }; },
    cancelChat: (runId: string) => cancelled.push(runId),
    chat: async (runId: string) => { queueMicrotask(() => script((event) => listener({ runId, event }))); },
  } } };
  return cancelled;
}

test("collects streamed text and the session id", async () => {
  install((emit) => { emit({ type: "session", sessionId: "s1" }); emit({ type: "text", text: "he" }); emit({ type: "text", text: "llo" }); emit({ type: "done" }); });
  const seen: string[] = [];
  const result = await runAgentChat("claude", "hi", { signal: new AbortController().signal, onText: (text) => seen.push(text) });
  expect(result).toEqual({ text: "hello", sessionId: "s1" });
  expect(seen).toEqual(["he", "hello"]);
});

test("rejects with the agent error and stops on abort", async () => {
  install((emit) => emit({ type: "error", message: "boom" }));
  await expect(runAgentChat("codex", "hi", { signal: new AbortController().signal })).rejects.toThrow("boom");
  const cancelled = install(() => {});
  const controller = new AbortController();
  const pending = runAgentChat("codex", "hi", { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toThrow("Aborted");
  expect(cancelled).toHaveLength(1);
});
