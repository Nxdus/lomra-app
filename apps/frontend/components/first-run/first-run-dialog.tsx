"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FolderOpenIcon, KeyIcon, ArrowRightIcon } from "lucide-react";
import type { CanvasHandle } from "@/components/image-canvas";
import { loadSampleProject } from "./sample-project";
import { toast } from "@/components/ui/toast";

export function FirstRunDialog({
  open,
  onOpenChange,
  canvasRef,
  canvasReady,
  onOpenModelSetup,
  onStartBlank,
  onSampleLoaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvasRef: React.RefObject<CanvasHandle | null>;
  canvasReady: boolean;
  onOpenModelSetup: () => void;
  onStartBlank: () => void;
  onSampleLoaded: () => void;
}) {
  const [loadingSample, setLoadingSample] = useState(false);

  async function handleLoadSample() {
    if (!canvasRef.current || !canvasReady) {
      toast.add({ title: "Canvas is still initializing. Please retry in a moment.", type: "error" });
      return;
    }
    setLoadingSample(true);
    try {
      await loadSampleProject(canvasRef.current);
      toast.add({
        title: "Sample project loaded!",
        description: "Explore by selecting, moving, zooming, or editing items on the canvas.",
      });
      onSampleLoaded();
      onOpenChange(false);
    } catch (error) {
      toast.add({
        title: "Could not load sample project",
        description: error instanceof Error ? error.message : "Please retry.",
        type: "error",
      });
    } finally {
      setLoadingSample(false);
    }
  }

  function handleStartBlank() {
    onStartBlank();
    onOpenChange(false);
  }

  function handleSetupModels() {
    onOpenChange(false);
    onOpenModelSetup();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-5 rounded-3xl p-6 shadow-2xl">
        <DialogHeader className="gap-2 pr-6">
          <DialogTitle>Welcome to Lomra</DialogTitle>
          <DialogDescription className="flex flex-col gap-2 text-xs text-muted-foreground">
            <span>Local-first creative canvas for images, 3D, and video.</span>
            <span>Get started by exploring a bundled sample project or start with a fresh blank canvas.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={loadingSample ? undefined : handleLoadSample}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleLoadSample(); }}
            className="group relative flex cursor-pointer items-start gap-3.5 rounded-2xl border border-primary/20 bg-primary/5 p-4 transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <FolderOpenIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-medium text-sm text-foreground">
                <span>Explore sample project</span>
                <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-semibold text-primary">Recommended</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Load demo concept art, character card, and moodboard. Works immediately without network or API keys.
              </p>
            </div>
            <ArrowRightIcon className="size-4 shrink-0 self-center text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={handleSetupModels}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSetupModels(); }}
            className="group relative flex cursor-pointer items-start gap-3.5 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
              <KeyIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-medium text-sm text-foreground">
                <span>Set up models to generate</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect your Google AI, OpenRouter, Fal keys or local Ollama to create new media right away.
              </p>
            </div>
            <ArrowRightIcon className="size-4 shrink-0 self-center text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground" onClick={handleStartBlank}>
            Start with blank canvas
          </Button>
          <Button type="button" size="sm" disabled={loadingSample} onClick={handleLoadSample}>
            {loadingSample ? "Loading…" : "Explore demo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
