"use client";

import { useState, type RefObject } from "react";
import type { CanvasHandle } from "@/components/image-canvas";
import { FirstRunDialog } from "./first-run-dialog";
import { ModelSetupDialog } from "./model-setup-dialog";
import { dismissFirstRun, dismissSampleBanner, isSampleBannerDismissed, useFirstRun } from "./use-first-run";
import { Button } from "@/components/ui/button";
import { KeyIcon, SparklesIcon, XIcon } from "lucide-react";

export function FirstRunFlow({
  canvasRef,
  canvasReady,
}: {
  canvasRef: RefObject<CanvasHandle | null>;
  canvasReady: boolean;
}) {
  const { isFirstRun, setIsFirstRun } = useFirstRun();
  const [closed, setClosed] = useState(false);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [sampleBannerOpen, setSampleBannerOpen] = useState(false);

  const firstRunOpen = isFirstRun === true && !closed;

  function handleStartBlank() {
    dismissFirstRun();
    setIsFirstRun(false);
    setClosed(true);
  }

  function handleSampleLoaded() {
    dismissFirstRun();
    setIsFirstRun(false);
    setClosed(true);
    if (!isSampleBannerDismissed()) {
      setSampleBannerOpen(true);
    }
  }

  function handleOpenModelSetup() {
    dismissFirstRun();
    setIsFirstRun(false);
    setClosed(true);
    setModelSetupOpen(true);
  }

  function handleDismissBanner() {
    dismissSampleBanner();
    setSampleBannerOpen(false);
  }

  return (
    <>
      <FirstRunDialog
        open={firstRunOpen}
        onOpenChange={(open) => {
          if (!open) handleStartBlank();
        }}
        canvasRef={canvasRef}
        canvasReady={canvasReady}
        onOpenModelSetup={handleOpenModelSetup}
        onStartBlank={handleStartBlank}
        onSampleLoaded={handleSampleLoaded}
      />

      <ModelSetupDialog
        open={modelSetupOpen}
        onOpenChange={setModelSetupOpen}
      />

      {sampleBannerOpen && (
        <aside
          aria-label="First-run sample project actions"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-full border border-border/80 bg-background/90 px-3.5 py-1.5 shadow-md backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-3" />
          </div>
          <span className="text-xs text-muted-foreground">
            Sample project loaded · Ready to generate?
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 rounded-full px-2 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => {
              handleDismissBanner();
              setModelSetupOpen(true);
            }}
          >
            <KeyIcon className="size-3" />
            Set up models
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-5 rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Dismiss banner"
            onClick={handleDismissBanner}
          >
            <XIcon className="size-3" />
          </Button>
        </aside>
      )}
    </>
  );
}
