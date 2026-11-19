"use client";

import { useRef, useState } from "react";
import { FloatingPrompt } from "@/components/prompt/floating-prompt";
import { ImageCanvas, type CanvasHandle, type VisibleImage } from "@/components/image-canvas";
import { PopupBoundaryContext } from "@/components/ui/popup-boundary";

export default function Home() {
  const canvas = useRef<CanvasHandle>(null);
  const [selection, setSelection] = useState<VisibleImage[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasId, setCanvasId] = useState("default");
  const [contentBoundary, setContentBoundary] = useState<HTMLElement | null>(null);
  return (
    <div className="flex h-dvh flex-col">
      <div
        aria-hidden="true"
        className="h-(--app-titlebar-space) shrink-0 overflow-hidden bg-background shadow-[inset_0_-1px_0_var(--border)]"
      >
        <div className="ml-[env(titlebar-area-x,0px)] h-(--app-titlebar-height) w-[env(titlebar-area-width,100%)] [app-region:drag]" />
      </div>
      <main ref={setContentBoundary} className="relative min-h-0 flex-1 overflow-hidden">
        <PopupBoundaryContext value={contentBoundary ?? undefined}>
          <ImageCanvas ref={canvas} onSelectionChange={setSelection} onReadyChange={setCanvasReady} onCanvasChange={setCanvasId} />
          <div className="relative z-10">
            <FloatingPrompt key={canvasId} canvasId={canvasId} loading={!canvasReady} selection={selection} onDeselect={(ids) => canvas.current?.deselect(ids)} onModelPreview={(id) => {
              if (!canvas.current) throw new Error("Canvas is not ready");
              return canvas.current.modelPreview(id);
            }} onAddToCanvas={(files) => {
              if (!canvas.current) throw new Error("Canvas is not ready");
              return canvas.current.addFiles(files);
            }} onFocusFile={(file) => {
              if (!canvas.current) throw new Error("Canvas is not ready");
              canvas.current.focusFile(file);
            }} />
          </div>
        </PopupBoundaryContext>
      </main>
    </div>
  );
}
