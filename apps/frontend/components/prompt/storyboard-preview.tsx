"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import type { Storyboard } from "./storyboard-data";

export type StoryboardDialogProps = {
  storyboard: Storyboard;
  images: readonly { name: string; url: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function StoryboardPreview({ storyboard, images, open, onOpenChange }: StoryboardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Storyboard preview</DialogTitle>
          <DialogDescription>Play the shot pictures at their storyboard timings.</DialogDescription>
        </DialogHeader>
        {open && <Playback storyboard={storyboard} images={images} />}
      </DialogContent>
    </Dialog>
  );
}

function Playback({ storyboard, images }: Pick<StoryboardDialogProps, "storyboard" | "images">) {
  const shots = storyboard.shots ?? [];
  const ends: number[] = [];
  for (const { seconds } of shots) ends.push((ends.at(-1) ?? 0) + seconds);
  const total = ends.at(-1) ?? 0;
  const position = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || total <= 0) return;
    let last = performance.now();
    let frame = requestAnimationFrame(tick);
    function tick(now: number) {
      position.current = Math.min(position.current + (now - last) / 1000, total);
      setElapsed(position.current);
      last = now;
      if (position.current < total) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    }
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);

  function seek(seconds: number) {
    position.current = seconds;
    setElapsed(seconds);
  }

  if (!shots.length) return <p className="text-muted-foreground">There are no shots to preview.</p>;
  const nextIndex = ends.findIndex((end) => end > elapsed);
  const index = nextIndex < 0 ? shots.length - 1 : nextIndex;
  const shot = shots[index];
  const url = (shot.image !== null ? images[shot.image]?.url : undefined)
    || (shot.generatedId ? `/api/storage/files/${encodeURIComponent(shot.generatedId)}` : undefined);

  return (
    <div className="space-y-4">
      <ShotPicture key={url} url={url} number={index + 1} />
      <div>
        <p className="font-medium">Shot {index + 1} of {shots.length}{shot.scene && ` · ${shot.scene}`}</p>
        <p className="line-clamp-3 text-muted-foreground">{shot.description}</p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" disabled={total <= 0} onClick={() => {
          if (!playing && elapsed >= total) seek(0);
          setPlaying(!playing);
        }}>{playing ? "Pause" : "Play"}</Button>
        <Slider aria-label="Playback position" min={0} max={total || 1} step={0.01}
          value={[elapsed]} disabled={total <= 0} onValueChange={(value) => seek(Array.isArray(value) ? value[0] : value)} />
        <span className="shrink-0 tabular-nums text-muted-foreground">{elapsed.toFixed(1)} / {total.toFixed(1)} s</span>
      </div>
    </div>
  );
}

function ShotPicture({ url, number }: { url?: string; number: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-muted">
      {url && !failed
        // Shot pictures can be local workspace assets or inline owner-chat images.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={`Storyboard shot ${number}`} className="size-full object-contain" onError={() => setFailed(true)} />
        : <p className="text-muted-foreground">No picture available for this shot.</p>}
    </div>
  );
}
