import { desktopAgents, type AgentLimit } from "@/lib/desktop";

export const agentLabels = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" } as const;
export type AgentEngine = keyof typeof agentLabels;
/** Reasoning effort levels the desktop app accepts per agent; OpenCode has none. */
export const agentEfforts: Partial<Record<AgentEngine, readonly string[]>> = { claude: ["low", "medium", "high", "xhigh", "max"], codex: ["low", "medium", "high", "xhigh"] };

export function localAgentModel(model: string | undefined): { engine: AgentEngine; modelId?: string } | undefined {
  const [prefix, engine, modelId, ...rest] = model?.split("/") ?? [];
  if (prefix === "local-agent" && engine in agentLabels && !rest.length) return { engine: engine as AgentEngine, modelId };
}

/** Run one turn on a local agent CLI and resolve with its full reply. Aborting stops the process. */
export async function runAgentChat(agent: string, prompt: string, options: { sessionId?: string; modelId?: string; effort?: string; signal: AbortSignal; onText?: (text: string) => void; onTool?: (name: string) => void; onLimits?: (windows: AgentLimit[]) => void }) {
  const bridge = desktopAgents();
  if (!bridge) throw new Error("Local agents are only available in the desktop app");
  options.signal.throwIfAborted();
  const runId = crypto.randomUUID();
  let text = "";
  let sessionId = options.sessionId;
  let off = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    off = bridge.onChat((message) => {
      if (message.runId !== runId) return;
      const { event } = message;
      if (event.type === "text") { text += event.text; options.onText?.(text); }
      else if (event.type === "tool") options.onTool?.(event.name);
      else if (event.type === "session") sessionId = event.sessionId;
      else if (event.type === "limits") options.onLimits?.(event.windows);
      else if (event.type === "done") resolve();
      else reject(new Error(event.message));
    });
  });
  const stop = () => bridge.cancelChat(runId);
  options.signal.addEventListener("abort", stop, { once: true });
  try {
    await bridge.chat(runId, agent, prompt, options.sessionId, options.modelId, options.effort);
    await Promise.race([finished, new Promise<never>((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))]);
    return { text: text.trim(), sessionId };
  } finally {
    options.signal.removeEventListener("abort", stop);
    off();
  }
}
