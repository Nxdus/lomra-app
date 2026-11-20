"use client";

import { useEffect, useState } from "react";
import { storage } from "@/lib/storage";

export const FIRST_RUN_STORAGE_KEY = "lomra-first-run-done";
export const SAMPLE_BANNER_STORAGE_KEY = "lomra-sample-banner-dismissed";

export async function checkIsFirstRun(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const dismissed = localStorage.getItem(FIRST_RUN_STORAGE_KEY);
    if (dismissed === "true") return false;

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

export function dismissSampleBanner() {
  if (typeof window !== "undefined") {
    localStorage.setItem(SAMPLE_BANNER_STORAGE_KEY, "true");
  }
}

export function isSampleBannerDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(SAMPLE_BANNER_STORAGE_KEY) === "true";
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
