"use client";

import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Tip } from "@/components/tip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDisabledAgents } from "@/hooks/use-disabled-agents";
import { toast } from "@/components/ui/toast";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { readClaudeLimits } from "@/components/prompt/agent-limits";
import { desktopAgents, type AgentInfo, type AgentLimit, type AgentStats } from "@/lib/desktop";

function resetText(resetsAt: number, now: number) {
  const minutes = Math.round((resetsAt * 1000 - now) / 60_000);
  if (minutes <= 0) return "Reset";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return `Resets in ${days ? `${days}d ` : ""}${hours ? `${hours}h ` : ""}${days ? "" : `${minutes % 60}m`}`.trim();
}

const formatCount = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** Local agents found on this computer, with their plan usage (5 hr, weekly). */
export function AgentSettings() {
  const bridge = desktopAgents();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<Record<string, AgentLimit[]>>({});
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [listError, setListError] = useState(false);
  const { disabled, setEnabled } = useDisabledAgents();

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.list().then((list) => {
      if (cancelled) return;
      setAgents(list);
      setListError(false);
      for (const agent of list) {
        if (!agent.available) continue;
        void bridge.accountEmail(agent.id).then((email) => {
          if (!cancelled && email) setEmails((current) => ({ ...current, [agent.id]: email }));
        }, () => {});
      }
    }, () => { if (!cancelled) setListError(true); }).finally(() => { if (!cancelled) setRefreshing(false); });
    void bridge.stats?.("opencode").then((value) => { if (!cancelled) setStats(value); }, () => {});
    void Promise.all([bridge.limits("codex"), bridge.limits("claude"), readClaudeLimits()]).then(([codex, live, saved]) => {
      if (!cancelled) { setLimits({ codex, claude: live.length ? live : saved?.windows ?? [] }); setNow(Date.now()); }
    }, () => {});
    return () => { cancelled = true; };
  }, [bridge, refresh]);

  return <section aria-labelledby="agents-heading" className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <h2 id="agents-heading" className="text-sm font-medium">Local agents</h2>
      {bridge && <Tip label="Refresh local agents"><Button type="button" variant="outline" size="icon-sm" className="rounded-lg" aria-label="Refresh local agents" disabled={refreshing} onClick={() => { setRefreshing(true); setRefresh((value) => value + 1); }}>
        <RefreshCwIcon aria-hidden="true" className={refreshing ? "motion-safe:animate-spin" : undefined} />
      </Button></Tip>}
    </div>
    {!bridge ? <p role="status" className="text-xs text-muted-foreground">Local agents are available in the desktop app only.</p>
      : listError ? <Alert variant="destructive"><AlertDescription>Could not load local agents. Use Refresh to try again.</AlertDescription></Alert>
      : !agents ? <p role="status" className="text-xs text-muted-foreground">Looking for installed agents…</p>
      : !agents.length ? <p role="status" className="text-xs text-muted-foreground">No local agents found.</p>
      : <ul className="flex flex-col gap-2">
        {agents.map((agent) => {
          const windows = limits[agent.id] ?? [];
          return <li key={agent.id} className="flex flex-col gap-3 rounded-2xl border p-3 text-sm">
            <div className="flex items-center gap-3">
              <AgentIcon id={agent.id} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{agent.label}</div>
                {emails[agent.id] && <div className="mt-0.5 break-all text-xs text-muted-foreground">{emails[agent.id]}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs leading-none text-muted-foreground">{agent.available ? "Installed" : "Not found on PATH"}</span>
                {agent.available && <Switch size="sm" aria-label={`Use ${agent.label}`} checked={!disabled.includes(agent.id)}
                  onCheckedChange={(checked) => void setEnabled(agent.id, checked).catch(() => toast.add({ title: "Could not save agent settings. Please retry.", type: "error" }))} />}
              </div>
            </div>
            {agent.id === "opencode" && agent.available && !disabled.includes(agent.id) && (stats
              ? <p className="text-xs text-muted-foreground">Last {stats.days} days · {stats.sessions} sessions · {formatCount(stats.tokens)} tokens{stats.cost > 0 ? ` · $${stats.cost.toFixed(2)}` : ""}</p>
              : <p className="text-xs text-muted-foreground">Usage is billed by your provider.</p>)}
            {agent.id !== "opencode" && agent.available && !disabled.includes(agent.id) && (windows.length ? windows.map((window) => {
              const expired = window.resetsAt * 1000 <= now;
              const used = expired ? 0 : Math.round(window.usedPercent);
              return <div key={window.id} className="flex flex-col gap-1">
                <Progress value={used}>
                  <ProgressLabel className="text-xs">{window.label}</ProgressLabel>
                  <ProgressValue className="text-xs">{() => `${used}%`}</ProgressValue>
                </Progress>
                <span className="text-xs text-muted-foreground">{resetText(window.resetsAt, now)}</span>
              </div>;
            }) : <p className="text-xs text-muted-foreground">{agent.id === "claude" ? "Shown after your first message to Claude Code." : "No usage data yet."}</p>)}
          </li>;
        })}
      </ul>}
  </section>;
}
