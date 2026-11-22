"use client";

import { CameraIcon, EllipsisIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CanvasModelViewer } from "@/components/canvas-model-viewer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
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
  const [playback, setPlayback] = useState({ paused: true, time: 0, duration: 0, volume: 1, muted: false, rate: 1 });
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

  function updatePlayback(video: HTMLVideoElement) {
    const end = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
    setPlayback({
      paused: video.paused,
      time: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : Number.isFinite(end) ? end : 0,
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
    });
  }

  function openFullscreen(video: HTMLVideoElement) {
    // Keep the browser's playback controls available while the video itself is fullscreen.
    const restore = () => {
      if (document.fullscreenElement === video) return;
      video.controls = false;
      document.removeEventListener("fullscreenchange", restore);
    };
    document.addEventListener("fullscreenchange", restore);
    video.requestFullscreen().then(() => { video.controls = true; }).catch(() => {
      restore();
      toast.add({ title: "Could not open fullscreen.", type: "error" });
    });
  }

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
      <div className="flex size-full flex-col">
        <video
          ref={videoRef} key={attempt} src={image.url} controls={!onCaptureFrame} playsInline preload="metadata"
          aria-label={image.file.name} className="min-h-0 w-full flex-1 object-contain"
          onLoadedMetadata={(event) => { setLoaded(true); updatePlayback(event.currentTarget); }}
          onDurationChange={(event) => updatePlayback(event.currentTarget)}
          onProgress={(event) => updatePlayback(event.currentTarget)}
          onTimeUpdate={(event) => updatePlayback(event.currentTarget)}
          onPlay={(event) => updatePlayback(event.currentTarget)}
          onPause={(event) => updatePlayback(event.currentTarget)}
          onVolumeChange={(event) => updatePlayback(event.currentTarget)}
          onRateChange={(event) => updatePlayback(event.currentTarget)}
          onError={() => setError(true)}
        />
        {onCaptureFrame && loaded && !error && <div className="shrink-0 overflow-x-auto" onKeyDown={(event) => event.stopPropagation()}>
          <div className="flex min-w-28 items-center gap-1 p-1">
            <Button variant="ghost" size="icon-xs" aria-label={playback.paused ? "Play" : "Pause"} onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play().catch(() => toast.add({ title: "Could not play video.", type: "error" }));
              else video.pause();
            }}>
              {playback.paused ? <PlayIcon /> : <PauseIcon />}
            </Button>
            <Slider aria-label="Video timeline (seconds)" className="min-w-0 flex-1" min={0} max={playback.duration || 1}
              step={0.01} largeStep={5} disabled={!playback.duration} value={[Math.min(playback.time, playback.duration)]}
              onValueChange={(value) => {
                if (videoRef.current) videoRef.current.currentTime = typeof value === "number" ? value : value[0];
              }} />
            <Button variant="secondary" size="icon-xs" aria-label="Capture current frame as image" title="Capture current frame"
              disabled={capturing} onClick={captureFrame}>
              <CameraIcon aria-hidden="true" />
            </Button>
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Video options" />}>
                <EllipsisIcon />
              </PopoverTrigger>
              <PopoverContent data-canvas-interactive onKeyDown={(event) => event.stopPropagation()} className="w-48" side="top">
                <PopoverTitle>Video options</PopoverTitle>
                <Slider aria-label="Volume" min={0} max={1} step={0.05} value={[playback.muted ? 0 : playback.volume]}
                  onValueChange={(value) => {
                    const video = videoRef.current;
                    if (video) { video.volume = typeof value === "number" ? value : value[0]; video.muted = false; }
                  }} />
                <Button variant="outline" size="sm" onClick={() => { if (videoRef.current) videoRef.current.muted = !playback.muted; }}>
                  {playback.muted ? "Unmute" : "Mute"}
                </Button>
                <label className="flex items-center justify-between gap-2">
                  Speed
                  <select value={playback.rate} onChange={(event) => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }}>
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                  </select>
                </label>
                {typeof document !== "undefined" && document.fullscreenEnabled &&
                  <Button variant="outline" size="sm" onClick={() => { if (videoRef.current) openFullscreen(videoRef.current); }}>Fullscreen</Button>}
                {typeof document !== "undefined" && document.pictureInPictureEnabled &&
                  <Button variant="outline" size="sm" onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    void (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture())
                      .catch(() => toast.add({ title: "Could not change picture-in-picture.", type: "error" }));
                  }}>Picture-in-picture</Button>}
              </PopoverContent>
            </Popover>
          </div>
        </div>}
      </div>
    )
      : <CanvasModelViewer key={attempt} src={image.url} name={image.file.name} onLoad={() => setLoaded(true)} onError={() => setError(true)} />)}
    {!loaded && !error && <Skeleton className="pointer-events-none absolute inset-0 size-full motion-reduce:animate-none" role="status" aria-label={`Loading ${image.file.name}`} />}
    {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-muted p-3 text-center text-sm" data-canvas-interactive>
      <p role="alert">Could not load {image.file.name}</p>
      <Button variant="outline" size="sm" onClick={() => { setError(false); setLoaded(false); setAttempt(value => value + 1); }}>Retry</Button>
    </div>}
  </div>;
}
