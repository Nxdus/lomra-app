"use client";

import { CameraIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CanvasModelViewer } from "@/components/canvas-model-viewer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { canvasFileKind, loadCanvasFile } from "@/lib/image-canvas/image-canvas-storage";
import type { VisibleImage } from "@/components/image-canvas";

export function CanvasMedia({ image, onLoaded, onCaptureFrame }: {
  image: VisibleImage;
  onLoaded: (id: string, file: File) => void;
  onCaptureFrame?: (file: File) => void;
}) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { id, file, url } = image;
  useEffect(() => {
    if (url) return;
    let cancelled = false;
    loadCanvasFile({ id, file }).then(file => {
      if (!cancelled) onLoaded(id, file);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, file, url, attempt, onLoaded]);

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !onCaptureFrame || capturing) return;
    if (video.seeking || video.readyState < video.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      toast.add({ title: "No video frame is ready. Wait for the picture or press Play, then try again.", type: "error" });
      return;
    }
    setCapturing(true);
    try {
      const time = video.currentTime.toFixed(2);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable");
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG encoding failed");
      const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 480);
      onCaptureFrame(new File([blob], `${baseName}-frame-${time}s.png`, { type: "image/png" }));
    } catch {
      toast.add({ title: "Could not capture the video frame. Try again.", type: "error" });
    } finally {
      setCapturing(false);
    }
  }

  const kind = canvasFileKind(image.file);
  return <div className="relative size-full" aria-busy={!loaded && !error}>
    {image.url && (kind === "image" ? (
      // Local blob URLs need no Next.js image optimization.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={attempt} src={image.url} alt={image.file.name || "Pasted image"} draggable={false} className="size-full rounded-xl object-contain" onLoad={() => setLoaded(true)} onError={() => setError(true)} />
    ) : kind === "video" ? (
      <>
        <video ref={videoRef} key={attempt} src={image.url} controls playsInline preload="metadata" aria-label={image.file.name} className="size-full object-contain" onLoadedMetadata={() => setLoaded(true)} onError={() => setError(true)} />
        {onCaptureFrame && loaded && !error && (
          <Button
            className="absolute right-1 top-1"
            variant="secondary"
            size="icon-sm"
            aria-label="Capture current frame as image"
            title="Capture current frame"
            disabled={capturing}
            onClick={captureFrame}
          >
            <CameraIcon aria-hidden="true" />
          </Button>
        )}
      </>
    )
      : <CanvasModelViewer key={attempt} src={image.url} name={image.file.name} onLoad={() => setLoaded(true)} onError={() => setError(true)} />)}
    {!loaded && !error && <Skeleton className="pointer-events-none absolute inset-0 size-full motion-reduce:animate-none" role="status" aria-label={`Loading ${image.file.name}`} />}
    {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-muted p-3 text-center text-sm" data-canvas-interactive>
      <p role="alert">Could not load {image.file.name}</p>
      <Button variant="outline" size="sm" onClick={() => { setError(false); setLoaded(false); setAttempt(value => value + 1); }}>Retry</Button>
    </div>}
  </div>;
}
