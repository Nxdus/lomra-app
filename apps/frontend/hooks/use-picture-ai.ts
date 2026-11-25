"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopPictureAi, type DesktopPictureAiApi, type PictureAiStatus } from "@/lib/desktop";

/**
 * Downloads `modelId` after user confirmation and waits until it is installed or fails.
 * If already downloading/queued, waits for that job instead of starting a duplicate.
 */
export async function downloadPictureAiModel(
  bridge: DesktopPictureAiApi,
  modelId: string,
  modelName: string,
  signal: AbortSignal,
  onStatus?: (status: string) => void,
) {
  const initial = await bridge.status();
  const existing = initial.models.find((m) => m.id === modelId);
  if (existing?.installed) return;
  const inProgress = initial.downloading?.id === modelId || initial.queued.some((q) => q.id === modelId);
  if (!inProgress && !(await bridge.download(modelId))) {
    throw new Error(`Could not start downloading ${modelName}.`);
  }
  window.dispatchEvent(new Event("picture-ai-changed"));
  const stop = () => void bridge.cancelDownload(modelId);
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      signal.throwIfAborted();
      const status = await bridge.status();
      if (status.models.find((m) => m.id === modelId)?.installed) {
        window.dispatchEvent(new Event("picture-ai-changed"));
        return;
      }
      if (status.error) throw new Error(status.error);
      const active = status.downloading?.id === modelId;
      const queued = status.queued.some((q) => q.id === modelId);
      if (!active && !queued) throw new Error(`${modelName} did not finish downloading.`);
      if (active && status.downloading) {
        const pct = status.downloading.total > 0 ? Math.round(status.downloading.received / status.downloading.total * 100) : 0;
        onStatus?.(`Downloading ${modelName} · ${pct}%`);
      } else {
        onStatus?.(`Waiting to download ${modelName}…`);
      }
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Local background removal and upscaling in the desktop app: installed models and downloads in progress.
 * `status` is undefined while loading and null outside the desktop app.
 */
export function usePictureAi() {
  const [status, setStatus] = useState<PictureAiStatus | null | undefined>(undefined);
  const read = useCallback(async () => {
    try {
      return await desktopPictureAi()?.status() ?? null;
    } catch {
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
    window.addEventListener("picture-ai-changed", onChange);
    return () => window.removeEventListener("picture-ai-changed", onChange);
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

  const download = useCallback(async (id: string) => {
    const started = await desktopPictureAi()?.download(id);
    window.dispatchEvent(new Event("picture-ai-changed"));
    await refresh();
    return !!started;
  }, [refresh]);
  const cancel = useCallback(async (id?: string) => {
    await desktopPictureAi()?.cancelDownload(id);
    window.dispatchEvent(new Event("picture-ai-changed"));
    await refresh();
  }, [refresh]);
  const remove = useCallback(async (id: string) => {
    if (!await desktopPictureAi()?.remove(id)) throw new Error("Could not remove the model");
    window.dispatchEvent(new Event("picture-ai-changed"));
  }, []);
  return { status, refresh, download, cancel, remove };
}
