"use client";

import { useEffect, useState } from "react";
import { callProvider, type KeyedProvider } from "@/components/api-provider";
import { desktopLocal3d, desktopSd } from "@/lib/desktop";
import { storage } from "@/lib/storage";

export const FIRST_RUN_STORAGE_KEY = "lomra-first-run-done";

export async function checkIsFirstRun(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const firstRun = localStorage.getItem(FIRST_RUN_STORAGE_KEY);
    if (firstRun === "true") return false;
    if (firstRun === "setup") return true;

    // Check existing workspace data
    const [canvases, chats, keys] = await Promise.all([
      storage("canvas") as Promise<{ id: string; value: unknown[] }[]>,
      storage("chats") as Promise<{ id: string; value: unknown }[]>,
      storage("keys") as Promise<{ id: string; value: string }[]>,
    ]);

    // An existing user/workspace has existing canvas items, multiple canvases, saved chats, or saved keys
    const hasCanvasItems = Array.isArray(canvases) && canvases.some((c) => Array.isArray(c.value) && c.value.length > 0);
    const hasMultipleCanvases = Array.isArray(canvases) && canvases.length > 1;
    const hasChats = Array.isArray(chats) && chats.length > 0;
    const hasKeys = Array.isArray(keys) && keys.some((k) => typeof k?.value === "string" && k.value.trim().length > 0);

    if (hasCanvasItems || hasMultipleCanvases || hasChats || hasKeys) {
      // Mark as dismissed so existing workspaces are never disturbed again
      localStorage.setItem(FIRST_RUN_STORAGE_KEY, "true");
      return false;
    }

    return true;
  } catch {
    // If storage is unavailable or errors, fail safe: do not disturb the user
    return false;
  }
}

export function dismissFirstRun() {
  if (typeof window !== "undefined") {
    localStorage.setItem(FIRST_RUN_STORAGE_KEY, "true");
  }
}

export function beginTutorialSetup() {
  localStorage.setItem(FIRST_RUN_STORAGE_KEY, "setup");
}

export async function verifyTutorialProvider(keys: Record<KeyedProvider, string>) {
  const signal = AbortSignal.timeout(12_000);
  const checks = (Object.keys(keys) as KeyedProvider[])
    .filter((provider) => keys[provider])
    .map(async (provider) => {
      const result = await callProvider(provider, keys[provider], { action: "verify", signal }) as { connected?: boolean };
      if (!result?.connected) throw new Error("Provider connection could not be verified.");
    });
  checks.push((async () => {
    const response = await fetch("/api/ollama", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Ollama is unavailable.");
    const status = await response.json() as { running: boolean; models: { tools: boolean }[] };
    if (!status.running || !status.models.some(({ tools }) => tools)) throw new Error("No usable Ollama model.");
  })());
  for (const engine of [desktopSd(), desktopLocal3d()]) {
    if (!engine) continue;
    checks.push(engine.status().then((status) => {
      if (!status.models.some(({ installed }) => installed)) throw new Error("No installed local model.");
    }));
  }
  try {
    await Promise.any(checks);
  } catch {
    throw new Error("Save a working API key or install a local model before starting the tutorial.");
  }
}

export function useFirstRun() {
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkIsFirstRun().then((result) => {
      if (!cancelled) setIsFirstRun(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { isFirstRun, setIsFirstRun };
}
