"use client";

import { useState } from "react";
import { ApiKeysPanel } from "@/components/api-settings";
import { OllamaSettings } from "@/components/ollama-settings";
import { SdSettings } from "@/components/sd-settings";
import { Local3dSettings } from "@/components/local3d-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyIcon, CpuIcon } from "lucide-react";

const panelClassName = "-mx-3 min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain px-3 pb-4";

export function ModelSetupDialog({
  open,
  onOpenChange,
  defaultTab = "api",
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "api" | "local";
  onContinue?: () => Promise<void>;
}) {
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");

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
      if (!nextOpen) setError("");
      onOpenChange(nextOpen);
    }}>
      <DialogContent showCloseButton={!continuing} className="flex max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl p-5 pb-4 sm:p-6 sm:pb-5">
        <DialogHeader className="mb-4 shrink-0 gap-1.5 pr-8">
          <DialogTitle>Set up models to generate</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {onContinue
              ? "Save an API key or install a local model. Lomra checks that at least one provider is ready before starting the tutorial."
              : "Configure your cloud API keys (Google AI, OpenRouter, Fal.ai) or local models (Ollama, Stable Diffusion, Hunyuan 3D) to start generating."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} inert={continuing} className="min-h-0 flex-1 gap-4">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="api" className="flex items-center gap-1.5">
              <KeyIcon className="size-3.5" />
              API keys
            </TabsTrigger>
            <TabsTrigger value="local" className="flex items-center gap-1.5">
              <CpuIcon className="size-3.5" />
              Local models
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api" className={panelClassName}>
            <ApiKeysPanel />
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
