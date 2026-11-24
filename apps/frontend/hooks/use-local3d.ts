"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopLocal3d, type Local3dStatus } from "@/lib/desktop";

/**
 * Local image-to-3D in the desktop app: the installed models and any installation in progress.
 * `status` is undefined while loading and null outside the desktop app.
 */
export function useLocal3d() {
  const [status, setStatus] = useState<Local3dStatus | null | undefined>(undefined);
  const read = useCallback(async () => {
    try {
      return await desktopLocal3d()?.status() ?? null;
    } catch {
      // A desktop app started before this feature existed has no handler for it.
      return null;
    }
  }, []);
  const refresh = useCallback(async () => {
    const next = await read();
    setStatus(next);
    return next;
  }, [read]);
  useEffect(() => {
    const onRemove = () => void refresh();
    window.addEventListener("local3d-model-removed", onRemove);
    return () => window.removeEventListener("local3d-model-removed", onRemove);
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    void read().then((next) => { if (!cancelled) setStatus(next); });
    return () => { cancelled = true; };
  }, [read]);
  const installing = !!status?.installing || !!status?.queued.length;
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [installing, refresh]);

  const install = useCallback(async (id: string) => {
    const started = await desktopLocal3d()?.install(id);
    await refresh();
    return !!started;
  }, [refresh]);
  const cancel = useCallback(async (id: string) => { await desktopLocal3d()?.cancelInstall(id); await refresh(); }, [refresh]);
  const remove = useCallback(async (id: string) => {
    if (!await desktopLocal3d()?.remove(id)) throw new Error("Could not remove the model");
    window.dispatchEvent(new Event("local3d-model-removed"));
  }, []);
  return { status, refresh, install, cancel, remove };
}
