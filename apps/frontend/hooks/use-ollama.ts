"use client";

import { useEffect, useSyncExternalStore } from "react";
import { desktopOllama } from "@/lib/desktop";
import { storage } from "@/lib/storage";
import { defaultOllamaUrl, parseOllamaUrl } from "@/lib/ollama-url";

export type OllamaModel = { id: string; size: number; tools: boolean; vision: boolean };
/** A model download. `percent` is null until Ollama reports sizes; the byte counts cover all of its files. */
export type OllamaPull = { model: string; percent: number | null; status: string; completed: number; total: number };

type State = { running: boolean; models: OllamaModel[]; url: string; remote: boolean; /** The desktop app can start Ollama for the user. */ canStart: boolean; /** How the desktop app can install the CLI, or null when it is installed, remote or unavailable. */ installMethod: "winget" | "download" | null; /** The desktop app can remove the installed CLI (Windows). */ canUninstall: boolean };
type Store = { state: State | null; pull: OllamaPull | null; installing: boolean; uninstalling: boolean; starting: boolean };

// Downloads and installs outlive the settings screen: they live here, not in a component, so closing
// the dialog or switching tabs does not stop them and a screen opened later shows their progress.
const emptyModels: OllamaModel[] = [];
const initial: Store = { state: null, pull: null, installing: false, uninstalling: false, starting: false };
let store = initial;
const listeners = new Set<() => void>();
let controller: AbortController | undefined;

function emit(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

async function failure(response: Response, fallback: string) {
  try { return ((await response.json()) as { message?: string }).message ?? fallback; } catch { return fallback; }
}

async function load(): Promise<State> {
  // Only the desktop app can see the CLI; a browser can only ask the server that is already running.
  const cli = await desktopOllama()?.status().catch(() => undefined);
  try {
    const response = await fetch("/api/ollama", { cache: "no-store" });
    if (!response.ok) throw new Error("Unavailable");
    const result = await response.json() as Omit<State, "canStart" | "installMethod" | "canUninstall">;
    // The app can only start or install a server on this computer.
    const local = !!cli?.managed && !result.remote;
    return { ...result, canStart: !!cli?.installed && local, installMethod: cli && !cli.installed && local ? cli.installMethod : null, canUninstall: !!cli?.installed && local && cli.installMethod === "winget" };
  } catch {
    return { running: false, models: [], url: defaultOllamaUrl, remote: false, canStart: false, installMethod: null, canUninstall: false };
  }
}

async function refresh() { emit({ state: await load() }); }

/** What Ollama's progress line means to a person. */
function pullLabel(status: string) {
  if (status.startsWith("pulling manifest")) return "Starting…";
  if (status.startsWith("pulling")) return "Downloading";
  if (status.startsWith("verifying")) return "Verifying";
  if (status.startsWith("writing") || status === "success") return "Finishing";
  return status;
}

/** Downloads a model, reporting progress. Resolves once it is installed; rejects with a readable message. */
async function install(model: string) {
  if (controller) throw new Error("Another download is running");
  const abort = controller = new AbortController();
  emit({ pull: { model, percent: null, status: "Starting…", completed: 0, total: 0 } });
  try {
    const response = await fetch("/api/ollama", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pull", model }), signal: abort.signal,
    });
    if (!response.ok || !response.body) throw new Error(await failure(response, "Could not install the model"));
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    // A model is several files, each reporting its own size; the bar covers all of them and never moves back.
    const files = new Map<string, { total: number; completed: number }>();
    let buffer = "";
    let finished = false;
    const line = (value: string) => {
      if (!value.trim()) return;
      const event = JSON.parse(value) as { status?: string; error?: string; digest?: string; total?: number; completed?: number };
      if (event.error) throw new Error(event.error);
      if (event.status === "success") finished = true;
      if (event.digest && event.total) files.set(event.digest, { total: event.total, completed: event.completed ?? 0 });
      let total = 0;
      let completed = 0;
      for (const file of files.values()) { total += file.total; completed += file.completed; }
      const previous = store.pull;
      emit({ pull: {
        model, status: pullLabel(event.status ?? ""), total, completed: Math.max(completed, previous?.completed ?? 0),
        percent: total ? Math.max(previous?.percent ?? 0, Math.min(100, Math.floor(completed / total * 100))) : previous?.percent ?? null,
      } });
    };
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      buffer += next.value;
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    }
    line(buffer);
    if (!finished) throw new Error("The download was interrupted. Try again to resume it.");
  } catch (cause) {
    if (abort.signal.aborted) throw new Error("Download stopped. Install it again to resume.");
    throw cause;
  } finally {
    controller = undefined;
    emit({ pull: null });
    await refresh();
  }
}

const cancel = () => controller?.abort();

async function remove(model: string) {
  const response = await fetch("/api/ollama", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", model }),
  });
  if (!response.ok) throw new Error(await failure(response, "Could not remove the model"));
  await refresh();
}

/** Runs `ollama serve` through the desktop app. Resolves true once Ollama answers. */
async function start() {
  emit({ starting: true });
  try {
    const started = await desktopOllama()?.start();
    await refresh();
    return !!started;
  } finally { emit({ starting: false }); }
}

/** Installs the Ollama CLI through the desktop app, then starts it. Resolves the outcome for the caller to report. */
async function installCli() {
  if (store.installing) return "failed";
  emit({ installing: true });
  try {
    const result = await desktopOllama()?.install() ?? "failed";
    if (result === "installed") await desktopOllama()?.start();
    await refresh();
    return result;
  } finally { emit({ installing: false }); }
}

/** Stops Ollama and removes it through the desktop app. Downloaded models stay on disk. */
async function uninstallCli() {
  if (store.uninstalling || store.pull) return "failed";
  emit({ uninstalling: true });
  try {
    const result = await desktopOllama()?.uninstall() ?? "failed";
    await refresh();
    return result;
  } finally { emit({ uninstalling: false }); }
}

/** Points the app at another Ollama server; an empty address goes back to this computer. */
async function setServer(address: string) {
  const value = address.trim();
  const url = value ? parseOllamaUrl(value) : undefined;
  if (value && !url) throw new Error("Enter an address like http://192.168.1.20:11434");
  const custom = url && url !== defaultOllamaUrl;
  await storage("settings/ollama-url", custom ? "PUT" : "DELETE", custom ? url : undefined);
  await refresh();
}

/** The shared store behind the hook, exported for tests. */
export const ollamaStore = { subscribe, snapshot: () => store, install, cancel };

/** Models installed in the local Ollama, plus install and remove. `running` is null until the first check. */
export function useOllama() {
  const { state, pull, installing, uninstalling, starting } = useSyncExternalStore(subscribe, () => store, () => initial);
  useEffect(() => { void refresh(); }, []);
  return {
    running: state?.running ?? null, models: state?.models ?? emptyModels, pull, installing, uninstalling, starting,
    canStart: state?.canStart ?? false, canUninstall: state?.canUninstall ?? false, installMethod: state?.installMethod ?? null,
    url: state?.url ?? defaultOllamaUrl, remote: state?.remote ?? false,
    refresh, install, cancel, remove, start, installCli, uninstallCli, setServer,
  };
}
