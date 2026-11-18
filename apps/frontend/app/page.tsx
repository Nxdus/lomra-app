"use client";

import { useRef, useState } from "react";
import { FloatingPrompt } from "@/components/prompt/floating-prompt";
import { ImageCanvas, type CanvasHandle, type VisibleImage } from "@/components/image-canvas";
import { AgentPanel } from "@/components/agent-panel";

export default function Home() {
  const canvas = useRef<CanvasHandle>(null);
  const [selection, setSelection] = useState<VisibleImage[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasId, setCanvasId] = useState("default");
  return (
    <main className="relative h-dvh overflow-hidden">
      <AgentPanel />
      <ImageCanvas ref={canvas} onSelectionChange={setSelection} onReadyChange={setCanvasReady} onCanvasChange={setCanvasId} />
      <div className="relative z-10">
        <FloatingPrompt key={canvasId} canvasId={canvasId} loading={!canvasReady} selection={selection} onModelPreview={(id) => {
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
    </main>
  );
}
