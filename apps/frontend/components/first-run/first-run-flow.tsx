"use client";

import { useState, type RefObject } from "react";
import { useApiProviders } from "@/components/api-provider";
import type { CanvasHandle } from "@/components/image-canvas";
import { toast } from "@/components/ui/toast";
import { FirstRunDialog } from "./first-run-dialog";
import { ModelSetupDialog } from "./model-setup-dialog";
import { loadSampleProject } from "./sample-project";
import { beginTutorialSetup, dismissFirstRun, useFirstRun, verifyTutorialProvider } from "./use-first-run";

export function FirstRunFlow({ canvasRef, canvasReady }: {
  canvasRef: RefObject<CanvasHandle | null>;
  canvasReady: boolean;
}) {
  const { isFirstRun, setIsFirstRun } = useFirstRun();
  const { keys, keysReady, storageError } = useApiProviders();
  const [setupOpen, setSetupOpen] = useState(false);

  function finishFirstRun() {
    dismissFirstRun();
    setIsFirstRun(false);
    setSetupOpen(false);
  }

  async function startTutorial() {
    const canvas = canvasRef.current;
    if (!canvas || !canvasReady) throw new Error("Canvas is still loading. Try again shortly.");
    if (!keysReady && !storageError) throw new Error("API keys are still loading. Try again shortly.");
    await verifyTutorialProvider(keys);
    await loadSampleProject(canvas);
    finishFirstRun();
    toast.add({
      title: "Sample project loaded",
      description: "Try selecting, moving, or editing items on the canvas.",
    });
  }

  return (
    <>
      <FirstRunDialog
        open={isFirstRun === true && !setupOpen}
        onStartBlank={finishFirstRun}
        onStartTutorial={() => {
          beginTutorialSetup();
          setSetupOpen(true);
        }}
      />
      <ModelSetupDialog open={setupOpen} onOpenChange={setSetupOpen} onContinue={startTutorial} />
    </>
  );
}
