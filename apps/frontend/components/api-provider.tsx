"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { storage } from "@/lib/storage";

export type Provider = "openrouter" | "fal";
type Keys = Record<Provider, string>;
export type ProviderRequest = {
  action: "verify" | "usage" | "credits" | "chat" | "submit" | "status" | "result" | "route" | "image" | "video" | "video-status" | "video-content" | "cancel";
  model?: string;
  input?: unknown;
  requestId?: string;
  images?: string[];
  aspectRatio?: string;
  signal?: AbortSignal;
};

const ApiContext = createContext<{
  keys: Keys;
  setKey: (provider: Provider, key: string) => Promise<void>;
  keysReady: boolean;
  storageError: string;
  request: (provider: Provider, options: ProviderRequest) => Promise<unknown>;
} | null>(null);

export async function callProvider(provider: Provider, key: string, options: ProviderRequest): Promise<unknown> {
  if (!key) throw new Error("Enter your API key in Settings first");
  const response = await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ provider, ...options, signal: undefined }),
    cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(options.action === "image" ? 185_000 : 65_000), ...(options.signal ? [options.signal] : [])]),
  });
  if (response.ok && options.action === "video-content") return response.blob();
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Provider request failed");
  return result;
}

export function ApiProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Keys>({ openrouter: "", fal: "" });
  const [keysReady, setKeysReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void storage('keys').then((rows: { id: Provider; value: string }[]) => {
      if (cancelled) return;
      setKeys({ openrouter: rows.find((row) => row.id === 'openrouter')?.value ?? '', fal: rows.find((row) => row.id === 'fal')?.value ?? '' });
      setKeysReady(true);
    }).catch(() => { if (!cancelled) {
      const title = 'Could not load API keys. Reload to retry.';
      setStorageError(title);
      toast.add({ id: 'api-keys-error', title, type: 'error' });
    } });
    return () => { cancelled = true; };
  }, []);
  return <ApiContext.Provider value={{
    keys, keysReady, storageError,
    setKey: async (provider, key) => {
      if (!keysReady) throw new Error('API keys are still loading. Reload if this persists.');
      await storage(`keys/${provider}`, key.trim() ? 'PUT' : 'DELETE', key.trim() || undefined);
      setKeys((current) => ({ ...current, [provider]: key.trim() }));
    },
    request: (provider, options) => callProvider(provider, keys[provider], options),
  }}>{children}</ApiContext.Provider>;
}

export function useApiProviders() {
  const context = useContext(ApiContext);
  if (!context) throw new Error("useApiProviders requires ApiProvider");
  return context;
}
