"use client";

import { useRef, useState } from "react";
import { FloatingPrompt, type PromptHandle } from "@/components/prompt/floating-prompt";
import { ImageCanvas, type CanvasHandle, type VisibleImage } from "@/components/image-canvas";
import type { ImageBounds } from "@/lib/image-canvas/image-canvas-resize";
import { PopupBoundaryContext } from "@/components/ui/popup-boundary";
import { FirstRunFlow } from "@/components/first-run/first-run-flow";

export default function Home() {
  const canvas = useRef<CanvasHandle>(null);
  const prompt = useRef<PromptHandle>(null);
  const [selection, setSelection] = useState<VisibleImage[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasId, setCanvasId] = useState("default");
  const [promptBusy, setPromptBusy] = useState(false);
  const [storyboardHost, setStoryboardHost] = useState<HTMLElement | null>(null);
  const [storyboardOrigin, setStoryboardOrigin] = useState({ x: 0, y: 0 });
  const [videoItem, setVideoItem] = useState<string>();
  const [videoBounds, setVideoBounds] = useState<ImageBounds | null>(null);
  const [contentBoundary, setContentBoundary] = useState<HTMLElement | null>(null);
  return (
    <div className="flex h-dvh flex-col">
      <div
        aria-hidden="true"
        className="h-(--app-titlebar-space) shrink-0 overflow-hidden bg-background shadow-[inset_0_-1px_0_var(--border)]"
      >
        <div className="ml-[env(titlebar-area-x,0px)] h-(--app-titlebar-height) w-[env(titlebar-area-width,100%)] [app-region:drag]">
          <svg viewBox="0 0 512 512" aria-hidden="true" className="ml-2 size-4 translate-y-[calc((var(--app-titlebar-height)-1rem)/2)] fill-foreground">
            <path d="M1.7281 455.111C37.9931 327.111 17.4557 0 17.4557 0C93.9754 290.828 208.914 384.017 512 455.111C512 455.111 -34.5369 583.111 1.7281 455.111Z" />
          </svg>
        </div>
      </div>
      <main ref={setContentBoundary} className="relative min-h-0 flex-1 overflow-hidden">
        <PopupBoundaryContext value={contentBoundary ?? undefined}>
          <ImageCanvas ref={canvas} onSelectionChange={setSelection} onReadyChange={setCanvasReady} onCanvasChange={setCanvasId} onStoryboardHost={setStoryboardHost} onStoryboardOrigin={setStoryboardOrigin} watchItem={videoItem} onWatchedBounds={setVideoBounds} promptBusy={promptBusy} onUseSetup={(item, items) => void prompt.current?.useSetup(item, items)} onMakeVariations={(item, items) => void prompt.current?.makeVariations(item, items)} onGenerateAgain={(item, items) => void prompt.current?.generateAgain(item, items)} />
          <FirstRunFlow canvasRef={canvas} canvasReady={canvasReady} />
          <div className="relative z-10">
            <FloatingPrompt ref={prompt} key={canvasId} canvasId={canvasId} storyboardHost={storyboardHost} storyboardOrigin={storyboardOrigin} videoBounds={videoBounds} onVideoItem={setVideoItem} onRemoveFromCanvas={(ids) => canvas.current?.removeItems(ids)} onSelectItems={(ids) => canvas.current?.selectItems?.(ids)} onBusyChange={setPromptBusy} loading={!canvasReady} selection={selection} onDeselect={(ids) => canvas.current?.deselect(ids)} onModelPreview={(id) => {
              if (!canvas.current) throw new Error("Canvas is not ready");
              return canvas.current.modelPreview(id);
            }} onAddToCanvas={(files, at, harness, options) => {
              if (!canvas.current) throw new Error("Canvas is not ready");
              return canvas.current.addFiles(files, at, harness, options);
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
