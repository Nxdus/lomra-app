"use client";

import { useCallback, useEffect, useState } from "react";
import type { parseModelDetails } from "@/app/api/ollama/library";
import { localModelSuggestions } from "@/components/ollama-models";

let loaded: string[] | undefined;

/**
 * Names for the install field: the models ollama.com offers that can call tools. Until that list
 * arrives, or when it cannot be fetched, a short built-in list is used.
 */
export function useOllamaLibrary() {
  const [models, setModels] = useState(loaded ?? localModelSuggestions);
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    void fetch("/api/ollama/library").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { models?: unknown };
      if (!Array.isArray(result.models) || !result.models.length) return;
      loaded = result.models.filter((name): name is string => typeof name === "string");
      if (!cancelled) setModels(loaded);
    }, () => {});
    return () => { cancelled = true; };
  }, []);
  return models;
}

type ModelDetails = ReturnType<typeof parseModelDetails>;
const requests = new Map<string, Promise<ModelDetails | null>>();
const visibleRows = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | undefined;

function loadModelDetails(family: string) {
  let request = requests.get(family);
  if (!request) {
    request = fetch(`/api/ollama/library?family=${encodeURIComponent(family)}`).then(async (response) => {
      if (!response.ok) throw new Error("Model details unavailable");
      return await response.json() as ModelDetails;
    }).catch(() => {
      requests.delete(family);
      return null;
    });
    requests.set(family, request);
  }
  return request;
}

export function useOllamaModelDetails(family: string) {
  const [details, setDetails] = useState<ModelDetails | null>();
  const rowRef = useCallback((row: HTMLDivElement | null) => {
    if (!row) return;
    // One tags request per visible model family, even if several variants are on screen.
    const watcher = observer ??= new IntersectionObserver((entries, watcher) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watcher.unobserve(entry.target);
        visibleRows.get(entry.target)?.();
      }
    });
    let active = true;
    visibleRows.set(row, () => void loadModelDetails(family).then((result) => {
      if (active) setDetails(result);
    }));
    watcher.observe(row);
    return () => {
      active = false;
      watcher.unobserve(row);
      visibleRows.delete(row);
    };
  }, [family]);

  return { details, rowRef };
}
