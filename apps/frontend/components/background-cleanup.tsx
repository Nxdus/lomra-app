"use client";

import { useLayoutEffect, useReducer, useRef, useState, type PointerEvent } from "react";
import { EraserIcon, LoaderCircleIcon, Redo2Icon, Undo2Icon, PaintbrushIcon } from "lucide-react";
import { PictureTools } from "@/components/picture-tools";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tip } from "@/components/tip";
import { drawMarkup, emptyMarkup, markupHistory, type Markup, type Point } from "@/lib/image-canvas/picture-markup";

function paintSegment(ctx: CanvasRenderingContext2D, mask: CanvasRenderingContext2D, original: HTMLCanvasElement, stroke: Markup, end: Point, start = end) {
  const radius = stroke.width / 2 + 1;
  const x = Math.floor(Math.min(start.x, end.x) - radius);
  const y = Math.floor(Math.min(start.y, end.y) - radius);
  mask.canvas.width = Math.ceil(Math.max(start.x, end.x) + radius) - x;
  mask.canvas.height = Math.ceil(Math.max(start.y, end.y) + radius) - y;
  const points = start === end ? [end] : [start, end];
  drawMarkup(mask, [{ ...stroke, kind: "pen", points: points.map(p => ({ x: p.x - x, y: p.y - y })) }]);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(mask.canvas, x, y);
  if (stroke.kind === "pen") {
    // Put the original pixels back with the same coverage that removed the cutout.
    mask.globalCompositeOperation = "source-in";
    mask.drawImage(original, -x, -y, ctx.canvas.width, ctx.canvas.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(mask.canvas, x, y);
  }
  ctx.globalCompositeOperation = "source-over";
}

export function BackgroundCleanup({ original, cutout, saving, onSave, onCancel }: {
  original: HTMLCanvasElement;
  cutout: HTMLCanvasElement;
  saving: boolean;
  onSave: (result: HTMLCanvasElement) => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mask = useRef<CanvasRenderingContext2D | null>(null);
  const gesture = useRef<{ pointer: number; stroke: Markup } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [mode, setMode] = useState<"eraser" | "pen">("eraser");
  const [size, setSize] = useState(40);
  const [history, dispatch] = useReducer(markupHistory, emptyMarkup);
  const [cursor, setCursor] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const { width, height } = cutout;

  function paint(strokes: Markup[]) {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(cutout, 0, 0);
    for (const stroke of strokes) {
      stroke.points.forEach((end, i) => paintSegment(ctx, mask.current!, original, stroke, end, stroke.points[i - 1]));
    }
  }

  useLayoutEffect(() => {
    mask.current = document.createElement("canvas").getContext("2d")!;
    canvas.current!.getContext("2d")!.drawImage(cutout, 0, 0);
  }, [cutout]);

  function changeHistory(type: "undo" | "redo") {
    if (saving || gesture.current) return;
    paint(markupHistory(history, { type }).items);
    dispatch({ type });
  }

  function position(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    setCursor({ x, y, diameter: size * rect.width / width });
    return { x: x * width / rect.width, y: y * height / rect.height };
  }

  function finish(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    setDrawing(false);
    if (cancelled) paint(history.items);
    else dispatch({ type: "commit", items: [...history.items, active.stroke] });
  }

  return <>
    <div className="relative mx-auto w-fit max-w-full">
      <canvas ref={canvas} width={width} height={height} tabIndex={0} aria-label="Background cleanup canvas"
        className="block max-h-[min(80dvh,calc(var(--app-content-height)-5rem))] max-w-full touch-none rounded-4xl bg-card bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)] bg-size-[20px_20px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ aspectRatio: width / height, cursor: saving ? "wait" : "crosshair" }}
        onPointerDown={event => {
          if (saving || gesture.current || !event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const end = position(event);
          const stroke: Markup = { id: crypto.randomUUID(), kind: mode, color: "black", width: size, points: [end] };
          gesture.current = { pointer: event.pointerId, stroke };
          setDrawing(true);
          paintSegment(event.currentTarget.getContext("2d")!, mask.current!, original, stroke, end);
        }}
        onPointerMove={event => {
          if (saving || !event.isPrimary) return;
          const end = position(event);
          const active = gesture.current;
          if (active?.pointer !== event.pointerId) return;
          const start = active.stroke.points.at(-1)!;
          if (start.x === end.x && start.y === end.y) return;
          active.stroke.points.push(end);
          paintSegment(event.currentTarget.getContext("2d")!, mask.current!, original, active.stroke, end, start);
        }}
        onPointerUp={event => finish(event)}
        onPointerCancel={event => finish(event, true)}
        onLostPointerCapture={event => finish(event, true)}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={event => {
          const key = event.key.toLowerCase();
          if (!(event.ctrlKey || event.metaKey) || (key !== "z" && key !== "y")) return;
          event.preventDefault();
          event.stopPropagation();
          changeHistory(key === "y" || event.shiftKey ? "redo" : "undo");
        }}
      />
      {cursor && !saving && <div aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary ring-1 ring-background" style={{ left: cursor.x, top: cursor.y, width: cursor.diameter, height: cursor.diameter }} />}
      <div className="absolute -left-3 top-1/2 flex h-44 max-h-[max(5rem,100%)] -translate-y-1/2 flex-col items-center rounded-4xl border bg-popover p-3 text-popover-foreground shadow-md">
        <Slider className="[&_[data-slot=slider-control]]:min-h-0" orientation="vertical" aria-label="Brush size" min={1} max={200} value={[size]} onValueChange={value => setSize(Array.isArray(value) ? value[0] : value)} disabled={saving || drawing} />
      </div>
    </div>
    <PictureTools>
      <ToggleGroup value={[mode]} onValueChange={value => { if (value[0]) setMode(value[0] as typeof mode); }} disabled={saving || drawing} size="sm" aria-label="Background cleanup brushes">
        <ToggleGroupItem value="eraser" aria-label="Erase pixels"><EraserIcon data-icon="inline-start" />Erase</ToggleGroupItem>
        <ToggleGroupItem value="pen" aria-label="Restore pixels"><PaintbrushIcon data-icon="inline-start" />Restore</ToggleGroupItem>
      </ToggleGroup>
      <Tip label="Undo · Ctrl/⌘ Z"><Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!history.past.length || saving || drawing} onClick={() => changeHistory("undo")}><Undo2Icon /></Button></Tip>
      <Tip label="Redo · Ctrl/⌘ Shift Z"><Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!history.future.length || saving || drawing} onClick={() => changeHistory("redo")}><Redo2Icon /></Button></Tip>
      <Button variant="ghost" size="sm" disabled={saving || drawing} onClick={onCancel}>Cancel</Button>
      <Button size="sm" disabled={saving || drawing} onClick={() => onSave(canvas.current!)}>{saving && <LoaderCircleIcon aria-hidden="true" data-icon="inline-start" className="motion-safe:animate-spin" />}{saving ? "Saving…" : "Save PNG"}</Button>
    </PictureTools>
  </>;
}
