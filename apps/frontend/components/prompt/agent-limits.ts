import type { AgentLimit } from "@/lib/desktop";
import { getSetting, saveSetting } from "@/lib/settings";

export type SavedLimits = { windows: AgentLimit[]; updatedAt: number };

/** Claude reports its 5 hr / weekly usage only while a message runs, so keep the last reading. */
export const readClaudeLimits = async () => (await getSetting<{ claude?: SavedLimits }>("agent-limits"))?.claude;

export const saveAgentLimits = (windows: AgentLimit[]) => saveSetting("agent-limits", { claude: { windows, updatedAt: Date.now() } });
