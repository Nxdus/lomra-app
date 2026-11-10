"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";

export function CanvasModelViewer({ src, name }: { src: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading 3D model…");

  useEffect(() => {
    const container = host.current!;
    let disposed = false;
    let viewer: HTMLElement | undefined;
    const loaded = () => setStatus("");
    const failed = () => {
      setStatus("");
      toast.add({ id: `model-preview-error:${src}`, title: `Could not display ${name}. Check the file and WebGL support.`, type: "error" });
    };
    import("@google/model-viewer").then(() => {
      if (disposed) return;
      viewer = document.createElement("model-viewer");
      viewer.setAttribute("src", src);
      viewer.setAttribute("alt", name);
      viewer.setAttribute("camera-controls", "");
      viewer.setAttribute("touch-action", "none");
      viewer.setAttribute("loading", "eager");
      viewer.setAttribute("interaction-prompt", "none");
      viewer.style.width = "100%";
      viewer.style.height = "100%";
      viewer.addEventListener("load", loaded);
      viewer.addEventListener("error", failed);
      container.append(viewer);
    }).catch(() => { if (!disposed) failed(); });
    return () => {
      disposed = true;
      viewer?.removeEventListener("load", loaded);
      viewer?.removeEventListener("error", failed);
      viewer?.remove();
    };
  }, [src, name]);

  return <div className="relative size-full" data-canvas-interactive>
    <div ref={host} className="size-full" />
    {status && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">{status}</p>}
  </div>;
}
