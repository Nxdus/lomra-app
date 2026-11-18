"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcwIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { desktopAgents, type AgentInfo } from "@/lib/desktop";

type Session = { status: "starting" | "running" | "exited"; error?: string };

/** Agent CLI terminal (desktop app only): runs Claude Code or Codex in the workspace folder. */
export function AgentPanel() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState<string>();
  const [restart, setRestart] = useState(0);
  const [session, setSession] = useState<Session>({ status: "starting" });
  const container = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const bridge = desktopAgents();
    if (!bridge) return;
    bridge.list().then((list) => {
      setAgents(list);
      setActive((list.find((agent) => agent.available) ?? list[0])?.id);
    }, () => setAgents([]));
  }, []);

  // One terminal per selected agent; closing the panel only hides it so the session keeps running.
  useEffect(() => {
    const host = container.current;
    const api = desktopAgents();
    if (!api || !active || !host || !agents.find((agent) => agent.id === active)?.available || !started) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;
      const terminal = new Terminal({ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13, cursorBlink: true, scrollback: 5000, theme: { background: "#0a0a0a" } });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(host);
      const refit = () => {
        if (!openRef.current) return;
        fit.fit();
        api.resize(active, terminal.cols, terminal.rows);
      };
      fit.fit();
      cleanups.push(() => terminal.dispose());
      const offData = api.onData((event) => { if (event.id === active) terminal.write(event.data); });
      const offExit = api.onExit((event) => {
        if (event.id !== active) return;
        terminal.write(`\r\n[process exited with code ${event.exitCode}]\r\n`);
        setSession({ status: "exited" });
      });
      cleanups.push(offData, offExit);
      const input = terminal.onData((data) => api.write(active, data));
      cleanups.push(() => input.dispose());
      const observer = new ResizeObserver(refit);
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
      try {
        const { replay } = await api.start(active, terminal.cols, terminal.rows);
        if (disposed) return;
        if (replay) terminal.write(replay);
        setSession({ status: "running" });
      } catch (error) {
        if (!disposed) setSession({ status: "exited", error: error instanceof Error ? error.message : "Could not start the agent" });
      }
    })();
    return () => {
      disposed = true;
      for (const cleanup of cleanups.reverse()) cleanup();
      host.replaceChildren();
    };
  }, [active, agents, restart, started]);

  if (!agents.length) return null;
  const current = agents.find((agent) => agent.id === active);
  return (
    <>
      <Button variant="outline" size="icon-sm" className="fixed top-4 right-4 z-20" aria-label="Open agent terminal" title="Agent terminal" onClick={() => { setOpen(true); setStarted(true); }}>
        <SquareTerminalIcon aria-hidden="true" />
      </Button>
      <aside aria-label="Agent terminal" hidden={!open} className="fixed inset-y-0 right-0 z-30 flex w-[min(640px,100vw)] flex-col border-l bg-background shadow-xl">
        <header className="flex items-center gap-1 border-b p-2">
          {agents.map((agent) => (
            <Button key={agent.id} size="sm" variant={agent.id === active ? "secondary" : "ghost"} disabled={!agent.available}
              title={agent.available ? undefined : `${agent.label} is not installed`}
              onClick={() => { setSession({ status: "starting" }); setActive(agent.id); }}>
              {agent.label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {session.status === "exited" && (
              <Button size="sm" variant="outline" onClick={() => { setSession({ status: "starting" }); setRestart((value) => value + 1); }}>
                <RotateCcwIcon data-icon="inline-start" /> Restart
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" aria-label="Close agent terminal" onClick={() => setOpen(false)}><XIcon aria-hidden="true" /></Button>
          </div>
        </header>
        {session.error && <p role="alert" className="border-b px-3 py-2 text-sm text-destructive">{session.error}</p>}
        {!current?.available && <p className="px-3 py-2 text-sm text-muted-foreground">No supported agent CLI was found on your PATH. Install Claude Code or Codex.</p>}
        <div ref={container} className="min-h-0 flex-1 bg-[#0a0a0a] p-2" />
      </aside>
    </>
  );
}
