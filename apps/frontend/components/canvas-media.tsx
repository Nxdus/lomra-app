"use client";

import { useEffect, useState } from "react";
import { CanvasModelViewer } from "@/components/canvas-model-viewer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canvasFileKind, loadCanvasFile } from "@/lib/image-canvas/image-canvas-storage";
import type { VisibleImage } from "@/components/image-canvas";

export function CanvasMedia({ image, onLoaded }: { image: VisibleImage; onLoaded: (id: string, file: File) => void }) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { id, file, url } = image;
  useEffect(() => {
    if (url) return;
    let cancelled = false;
    loadCanvasFile({ id, file }).then(file => {
      if (!cancelled) onLoaded(id, file);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, file, url, attempt, onLoaded]);

  const kind = canvasFileKind(image.file);
  return <div className="relative size-full" aria-busy={!loaded && !error}>
    {image.url && (kind === "image" ? (
      // Local blob URLs need no Next.js image optimization.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={attempt} src={image.url} alt={image.file.name || "Pasted image"} draggable={false} className="size-full rounded-xl object-contain" onLoad={() => setLoaded(true)} onError={() => setError(true)} />
    ) : kind === "video" ? <video key={attempt} src={image.url} controls playsInline preload="metadata" aria-label={image.file.name} className="size-full object-contain" onLoadedMetadata={() => setLoaded(true)} onError={() => setError(true)} />
      : <CanvasModelViewer key={attempt} src={image.url} name={image.file.name} onLoad={() => setLoaded(true)} onError={() => setError(true)} />)}
    {!loaded && !error && <Skeleton className="pointer-events-none absolute inset-0 size-full motion-reduce:animate-none" role="status" aria-label={`Loading ${image.file.name}`} />}
    {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-muted p-3 text-center text-sm" data-canvas-interactive>
      <p role="alert">Could not load {image.file.name}</p>
      <Button variant="outline" size="sm" onClick={() => { setError(false); setLoaded(false); setAttempt(value => value + 1); }}>Retry</Button>
    </div>}
  </div>;
}
