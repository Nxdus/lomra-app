"use client";

import { useState } from "react";
import { ApiKeysPanel } from "@/components/api-settings";
import type { KeyedProvider } from "@/components/api-provider";
import { OllamaSettings } from "@/components/ollama-settings";
import { SdSettings } from "@/components/sd-settings";
import { Local3dSettings } from "@/components/local3d-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const panelClassName = "-mx-3 min-h-0 max-h-[min(38rem,calc(100vh-14rem))] overflow-y-auto overscroll-contain px-3 pb-4";

function providerLabel(provider?: KeyedProvider | "local" | null) {
  if (provider === "fal") return "Fal.AI";
  if (provider === "google") return "Google AI";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "local") return "Local";
  return "";
}

export function ModelSetupDialog({
  open,
  onOpenChange,
  defaultTab = "api",
  targetProvider,
  modelName,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "api" | "local";
  targetProvider?: KeyedProvider | "local" | null;
  modelName?: string | null;
  onContinue?: () => Promise<void>;
}) {
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");
  const [userTab, setUserTab] = useState<"api" | "local" | null>(null);
  const activeTab = userTab ?? (targetProvider === "local" ? "local" : defaultTab);

  async function finishSetup() {
    if (!onContinue) {
      onOpenChange(false);
      return;
    }
    setContinuing(true);
    setError("");
    try {
      await onContinue();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the tutorial. Try again.");
    } finally {
      setContinuing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (continuing) return;
      if (!nextOpen) {
        setError("");
        setUserTab(null);
      }
      onOpenChange(nextOpen);
    }}>
      <DialogContent showCloseButton={!continuing} className="flex max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl p-5 pb-4 sm:p-6 sm:pb-5">
        <DialogHeader className="mb-4 shrink-0 gap-1.5 pr-8">
          <DialogTitle>Set up models to generate</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {onContinue
              ? "Save an API key or install a local model. Lomra checks that at least one provider is ready before starting the tutorial."
              : targetProvider && modelName
                ? `Add your ${providerLabel(targetProvider)} API key to start using ${modelName}.`
                : targetProvider
                  ? `Configure ${providerLabel(targetProvider)} to start generating.`
                  : "Configure your cloud API keys (Google AI, OpenRouter, Fal.ai) or local models (Ollama, Stable Diffusion, Hunyuan 3D) to start generating."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(val) => { setUserTab(val as "api" | "local"); setError(""); }} inert={continuing} className="min-h-0 flex-1 gap-4">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="api">API keys</TabsTrigger>
            <TabsTrigger value="local">Local models</TabsTrigger>
          </TabsList>

          <TabsContent value="api" className={panelClassName}>
            <ApiKeysPanel
              targetProvider={targetProvider}
              modelName={modelName}
              onVerified={() => setError("")}
              onKeyChange={() => setError("")}
            />
          </TabsContent>

          <TabsContent value="local" className={`${panelClassName} flex flex-col gap-5`}>
            <OllamaSettings />
            <Separator />
            <SdSettings />
            <Separator />
            <Local3dSettings />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4 flex-row flex-wrap items-center justify-end border-t border-border pt-3">
          {error && <p role="alert" className="mr-auto text-sm text-destructive">{error}</p>}
          <Button type="button" size="sm" disabled={continuing} onClick={() => void finishSetup()}>
            {continuing ? "Checking setup…" : onContinue ? "Continue to tutorial" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
