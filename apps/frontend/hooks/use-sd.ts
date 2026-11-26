"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopSd, type SdDownloadRequest, type SdStatus } from "@/lib/desktop";

/**
 * Local Stable Diffusion in the desktop app: the downloaded models and any download in progress.
 * `status` is undefined while loading and null outside the desktop app.
 */
export function useSd() {
  const [status, setStatus] = useState<SdStatus | null | undefined>(undefined);
  const read = useCallback(async () => {
    try {
      return await desktopSd()?.status() ?? null;
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
    const onChange = () => void refresh();
    window.addEventListener("sd-model-removed", onChange);
    window.addEventListener("sd-status-changed", onChange);
    return () => {
      window.removeEventListener("sd-model-removed", onChange);
      window.removeEventListener("sd-status-changed", onChange);
    };
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    void read().then((next) => { if (!cancelled) setStatus(next); });
    return () => { cancelled = true; };
  }, [read]);
  const downloading = !!status?.downloading || !!status?.queued.length;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [downloading, refresh]);

  const download = useCallback(async (request?: SdDownloadRequest) => {
    const started = await desktopSd()?.download(request);
    await refresh();
    return !!started;
  }, [refresh]);
  const cancel = useCallback(async (id: string) => { await desktopSd()?.cancelDownload(id); await refresh(); }, [refresh]);
  const remove = useCallback(async (id: string) => {
    if (!await desktopSd()?.remove(id)) throw new Error("Could not remove the model");
    window.dispatchEvent(new Event("sd-model-removed"));
  }, []);
  const setProfile = useCallback(async (id: string, profileId: string) => {
    if (!await desktopSd()?.setProfile(id, profileId)) throw new Error("Could not update the model profile");
    window.dispatchEvent(new Event("sd-status-changed"));
  }, []);
  return { status, refresh, download, cancel, remove, setProfile };
}
