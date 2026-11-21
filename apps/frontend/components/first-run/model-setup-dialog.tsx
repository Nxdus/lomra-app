"use client";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "api" | "local";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl p-5 pb-4 sm:p-6 sm:pb-5">
        <DialogHeader className="mb-4 shrink-0 gap-1.5 pr-8">
          <DialogTitle>Set up models to generate</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure your cloud API keys (Google AI, OpenRouter, Fal.ai) or local models (Ollama, Stable Diffusion, Hunyuan 3D) to start generating.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} className="min-h-0 flex-1 gap-4">
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

        <DialogFooter className="mt-4 flex-row justify-end border-t border-border pt-3">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
