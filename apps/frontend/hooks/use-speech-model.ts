"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getSetting, saveSetting } from "@/lib/settings";

const listeners = new Set<() => void>();
let selected: string | undefined;
let loading: Promise<void> | undefined;

function set(next: string) {
  selected = next;
  listeners.forEach((listener) => listener());
}

/** The speech model chosen for voice input; undefined until chosen, which means the app's default. */
export function useSpeechModel() {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => selected, () => undefined);
  useEffect(() => {
    loading ??= getSetting<string>("speech-model").then((saved) => { if (saved) set(saved); }, () => { loading = undefined; });
  }, []);
  const choose = useCallback(async (id: string) => {
    const previous = selected;
    set(id);
    try { await saveSetting("speech-model", id); } catch (error) { if (previous) set(previous); throw error; }
  }, []);
  return { model: current, choose };
}
