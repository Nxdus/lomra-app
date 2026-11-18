export type AgentInfo = { id: string; label: string; available: boolean };

/** Bridge exposed by the Electron preload script; absent in a normal browser. */
export type DesktopAgentApi = {
  list(): Promise<AgentInfo[]>;
  start(id: string, cols: number, rows: number): Promise<{ replay: string }>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  onData(callback: (event: { id: string; data: string }) => void): () => void;
  onExit(callback: (event: { id: string; exitCode: number }) => void): () => void;
};

export function desktopAgents(): DesktopAgentApi | undefined {
  return (window as unknown as { lomra?: { agent?: DesktopAgentApi } }).lomra?.agent;
}
