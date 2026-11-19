"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getSetting, saveSetting } from "@/lib/settings";

const listeners = new Set<() => void>();
const none: string[] = [];
let disabled = none;
let loading: Promise<void> | undefined;

function set(next: string[]) {
  disabled = next;
  listeners.forEach((listener) => listener());
}

/** Local agents the user switched off in Settings. Shared by every component that lists agents. */
export function useDisabledAgents() {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => disabled, () => none);
  useEffect(() => {
    loading ??= getSetting<string[]>("disabled-agents").then((saved) => { if (saved) set(saved); }, () => { loading = undefined; });
  }, []);
  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const previous = disabled;
    set(enabled ? previous.filter((item) => item !== id) : [...new Set([...previous, id])]);
    try { await saveSetting("disabled-agents", disabled); } catch (error) { set(previous); throw error; }
  }, []);
  return { disabled: current, setEnabled };
}
