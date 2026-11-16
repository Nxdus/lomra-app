"use client";

import { useEffect, useImperativeHandle, useReducer, useRef, useState, type PointerEvent, type Ref } from "react";
import { ArrowRightIcon, CheckIcon, CircleIcon, EraserIcon, LoaderCircleIcon, MinusIcon, MousePointer2Icon, PenLineIcon, PictureInPicture2Icon, Redo2Icon, ScanIcon, ShapesIcon, SquareIcon, TypeIcon, Undo2Icon, XIcon } from "lucide-react";
import { PictureTools, type PictureTool } from "@/components/picture-tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useApiProviders } from "@/components/api-provider";
import { generate, selectedModel } from "@/components/prompt/generation";
import { getSetting } from "@/lib/settings";
import { drawMarkup, emptyMarkup, hitMarkup, markupBounds, markupHistory, moveMarkup, type Markup, type MarkupKind, type Point } from "@/lib/image-canvas/picture-markup";
import { cn } from "@/lib/utils";

const ratios = [
  { label: "Square", value: "1:1", icon: SquareIcon },
  { label: "Portrait", value: "3:4", icon: PictureInPicture2Icon },
  { label: "Story", value: "9:16", icon: PictureInPicture2Icon },
  { label: "Landscape", value: "4:3", icon: PictureInPicture2Icon },
  { label: "Widescreen", value: "16:9", icon: PictureInPicture2Icon },
];
const shapes = [
  { label: "Rectangle", value: "rectangle", icon: SquareIcon },
  { label: "Ellipse", value: "ellipse", icon: CircleIcon },
  { label: "Line", value: "line", icon: MinusIcon },
  { label: "Arrow", value: "arrow", icon: ArrowRightIcon },
] as const;

function surface(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = width; result.height = height;
  if (!result.getContext("2d")) throw new Error("Image editing is unavailable in this browser.");
  return result;
}

export type PictureEditorHandle = { requestClose: () => boolean };

export function PictureEditor({ ref, url, name, onSave, onClose }: { ref?: Ref<PictureEditorHandle>; url: string; name: string; onSave: (file: File) => Promise<void>; onClose: () => void }) {
  const overlay = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const gesture = useRef<{ pointer: number; start: Point; item: Markup; moving: boolean; items: Markup[] } | null>(null);
  const job = useRef<AbortController | null>(null);
  const { keys, request } = useApiProviders();
  const [tool, setTool] = useState<PictureTool | null>(null);
  const [drawingTool, setDrawingTool] = useState<MarkupKind | "select">("pen");
  const [history, dispatch] = useReducer(markupHistory, emptyMarkup);
  const [selected, setSelected] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<(Point & { value: string; left: number; top: number }) | null>(null);
  const [discard, setDiscard] = useState<"mode" | "viewer" | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [color, setColor] = useState("#ef4444");
  const [size, setSize] = useState(4);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const dirty = history.items.length > 0 || !!textDraft?.value.trim();
  const painting = tool === "Markup" || tool === "Erase";

  useImperativeHandle(ref, () => ({ requestClose() {
    if (dirty || job.current) { setDiscard("viewer"); return false; }
    return true;
  } }));

  function error(cause: unknown) {
    toast.add({ title: "Could not edit picture", description: cause instanceof Error ? cause.message : "Please retry.", type: "error" });
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("Could not load picture.");
      const bitmap = await createImageBitmap(await response.blob());
      try {
        if (controller.signal.aborted) return;
        if (bitmap.width * bitmap.height > 16_000_000) throw new Error("Editing supports pictures up to 16 megapixels.");
        source.current = surface(bitmap.width, bitmap.height);
        source.current.getContext("2d")!.drawImage(bitmap, 0, 0);
        overlay.current!.width = bitmap.width; overlay.current!.height = bitmap.height;
        setReady(true);
      } finally { bitmap.close(); }
    })().catch(cause => { if (!controller.signal.aborted) error(cause); });
    return () => { controller.abort(); job.current?.abort(); };
  }, [url]);

  function paint(items: Markup[], selection = selected) {
    const ctx = overlay.current?.getContext("2d");
    if (!ctx) return;
    drawMarkup(ctx, items);
    const item = tool === "Markup" && drawingTool === "select" ? items.find(item => item.id === selection) : undefined;
    if (item) {
      const b = markupBounds(item);
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8); ctx.restore();
    }
  }

  useEffect(() => {
    const ctx = overlay.current?.getContext("2d");
    if (!ctx) return;
    drawMarkup(ctx, history.items);
    const item = drawingTool === "select" ? history.items.find(item => item.id === selected) : undefined;
    if (item) {
      const b = markupBounds(item);
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8); ctx.restore();
    }
  }, [history.items, selected, drawingTool, color, ready]);

  function reset() {
    dispatch({ type: "reset" }); setSelected(null); setTextDraft(null); setBrushCursor(null); gesture.current = null;
  }

  function enter(next: "Markup" | "Erase") {
    reset(); setTool(next); setDrawingTool("pen"); setSize(next === "Erase" ? 70 : 4);
  }

  function cancel() {
    if (dirty) setDiscard("mode");
    else { reset(); setTool(null); }
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(event.currentTarget.width, (event.clientX - rect.left) * event.currentTarget.width / rect.width)), y: Math.max(0, Math.min(event.currentTarget.height, (event.clientY - rect.top) * event.currentTarget.height / rect.height)) };
  }

  function gestureItems() {
    const active = gesture.current!;
    return active.moving ? active.items.map(item => item.id === active.item.id ? active.item : item) : [...active.items, active.item];
  }

  function finishStroke(cancelled = false) {
    if (!gesture.current) return;
    if (!cancelled) dispatch({ type: "commit", items: gestureItems() });
    else paint(history.items);
    gesture.current = null;
  }

  function addText() {
    if (!textDraft?.value.trim()) { setTextDraft(null); return; }
    dispatch({ type: "commit", items: [...history.items, { id: crypto.randomUUID(), kind: "text", points: [{ x: textDraft.x, y: textDraft.y }], color, width: size, text: textDraft.value.trim() }] });
    setTextDraft(null);
  }

  async function exportResult(result: HTMLCanvasElement, signal: AbortSignal) {
    const blob = await new Promise<Blob>((resolve, reject) => result.toBlob(value => value ? resolve(value) : reject(new Error("Could not export picture.")), "image/png"));
    signal.throwIfAborted();
    await onSave(new File([blob], `${name.replace(/\.[^.]+$/, "")}-edited.png`, { type: "image/png" }));
  }

  async function run(action: PictureTool, aspectRatio?: string) {
    if (!ready || job.current) return;
    const controller = new AbortController(); job.current = controller;
    setBusy(action === "Markup" ? "Adding markup…" : "Editing image…");
    try {
      const original = source.current!;
      if (action === "Markup") {
        const layer = surface(original.width, original.height);
        drawMarkup(layer.getContext("2d")!, history.items);
        const result = surface(original.width, original.height);
        result.getContext("2d")!.drawImage(original, 0, 0);
        result.getContext("2d")!.drawImage(layer, 0, 0);
        await exportResult(result, controller.signal);
      } else {
        const background = action === "Remove BG";
        if (action === "Erase" && !history.items.length) throw new Error("Brush over what you want to remove first.");
        if (!keys[background ? "fal" : "openrouter"]) throw new Error(`Enter your ${background ? "Fal" : "OpenRouter"} API key in Settings first.`);
        const model = background ? "fal-ai/birefnet/v2" : selectedModel(await getSetting<string[]>("selected-models") ?? [], "picture");
        controller.signal.throwIfAborted();
        if (!model) throw new Error("Select an Image model in the prompt toolbar first.");
        const references = [original.toDataURL("image/png")];
        if (action === "Erase") {
          const layer = surface(original.width, original.height);
          drawMarkup(layer.getContext("2d")!, history.items);
          const guide = surface(original.width, original.height), ctx = guide.getContext("2d")!;
          ctx.drawImage(original, 0, 0); ctx.globalAlpha = 0.55; ctx.drawImage(layer, 0, 0);
          drawMarkup(layer.getContext("2d")!, history.items.map(item => ({ ...item, color: "white" })));
          references.push(guide.toDataURL("image/png"), layer.toDataURL("image/png"));
        }
        const prompt = background ? "Remove background" : action === "Resize"
          ? `Recompose this image into a ${aspectRatio} aspect ratio. Preserve the subject, identity, style, lighting and details. Naturally extend the scene or rearrange surrounding space to fit the new composition. Do not stretch the image, add letterboxing or crop away the main subject.`
          : "Edit image 1. Image 2 highlights objects to remove; image 3 is a selection guide, not image content (white is selected). Remove the selected objects and naturally reconstruct the background from surrounding context. Return only the clean image at the original dimensions. Never render the mask, selection overlay, borders, frames, outlines or letterboxing. Preserve the composition and every unselected area.";
        const files = await generate({ id: crypto.randomUUID(), category: "picture", prompt, model, status: "Waiting", ...(aspectRatio ? { aspectRatio } : {}), ...(background ? { mediaTool: { name: "remove_background" as const, image_index: 0 } } : {}) }, request, controller.signal, change => { if (change.status && !controller.signal.aborted) setBusy(change.status); }, references[0], references);
        const response = await fetch(files[0].url, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not download the processed picture.");
        const bitmap = await createImageBitmap(await response.blob());
        try {
          controller.signal.throwIfAborted();
          if (bitmap.width * bitmap.height > 16_000_000) throw new Error("Processed picture is too large.");
          if (aspectRatio) {
            const [w, h] = aspectRatio.split(":").map(Number);
            if (Math.abs(bitmap.width / bitmap.height / (w / h) - 1) > 0.03) throw new Error("The selected model did not return the requested aspect ratio. Try another Image model.");
          }
          const result = action === "Erase" ? surface(original.width, original.height) : surface(bitmap.width, bitmap.height);
          const ctx = result.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0, result.width, result.height);
          if (action === "Erase") {
            const selection = surface(original.width, original.height);
            drawMarkup(selection.getContext("2d")!, history.items.map(item => ({ ...item, color: "white" })));
            // Only accept generated pixels inside the brush mask, including its antialiased edge.
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(selection, 0, 0);
            ctx.globalCompositeOperation = "destination-over";
            ctx.drawImage(original, 0, 0);
            ctx.globalCompositeOperation = "source-over";
          }
          await exportResult(result, controller.signal);
        } finally { bitmap.close(); }
      }
      if (!controller.signal.aborted) { reset(); setTool(null); }
    } catch (cause) { if (!controller.signal.aborted) error(cause); }
    finally { if (!controller.signal.aborted) { setBusy(""); job.current = null; } }
  }

  const historyControls = <>
    <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo · Ctrl/⌘ Z" disabled={!history.past.length || !!busy} onClick={() => dispatch({ type: "undo" })}><Undo2Icon /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo · Ctrl/⌘ Shift Z" disabled={!history.future.length || !!busy} onClick={() => dispatch({ type: "redo" })}><Redo2Icon /></Button>
  </>;

  return <>
    <div className="relative mx-auto w-fit max-w-full">
      {/* Local blob URLs need no Next.js image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name || "Image preview"} className="block max-h-[80dvh] max-w-full object-contain" />
      <canvas ref={overlay} tabIndex={painting ? 0 : -1} aria-label={tool === "Markup" ? "Draw on image" : tool === "Erase" ? "Mark areas to remove" : undefined} aria-hidden={!painting} className={cn("absolute inset-0 size-full outline-none", painting && !busy ? "touch-none cursor-crosshair" : "pointer-events-none", tool === "Markup" && drawingTool === "select" && "cursor-default", tool === "Erase" && "opacity-50")}
        onPointerDown={event => {
          if (!ready || busy || !painting || !event.isPrimary || event.button !== 0 || textDraft) return;
          event.preventDefault(); event.currentTarget.focus();
          const position = point(event);
          if (tool === "Markup" && drawingTool === "text") {
            const rect = event.currentTarget.getBoundingClientRect();
            const formWidth = Math.min(256, window.innerWidth - 64);
            const left = Math.max(16 - rect.left, Math.min(event.clientX - rect.left, window.innerWidth - 16 - formWidth - rect.left));
            setTextDraft({ ...position, value: "", left: left / rect.width * 100, top: Math.min(80, position.y / event.currentTarget.height * 100) }); return;
          }
          if (tool === "Markup" && drawingTool === "select") {
            const hit = hitMarkup(history.items, position, 8 * event.currentTarget.width / event.currentTarget.clientWidth);
            setSelected(hit?.id ?? null);
            if (!hit) return;
            gesture.current = { pointer: event.pointerId, start: position, item: hit, moving: true, items: history.items };
          } else {
            const item: Markup = { id: crypto.randomUUID(), kind: tool === "Erase" ? "pen" : drawingTool === "select" ? "pen" : drawingTool, points: [position], color: tool === "Erase" ? "#3b82f6" : color, width: size };
            gesture.current = { pointer: event.pointerId, start: position, item, moving: false, items: history.items };
            paint(gestureItems(), null);
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (painting && !busy && (tool === "Erase" || ["pen", "eraser"].includes(drawingTool))) {
            const p = point(event);
            setBrushCursor({ x: p.x / event.currentTarget.width * 100, y: p.y / event.currentTarget.height * 100, diameter: size * event.currentTarget.clientWidth / event.currentTarget.width });
          }
          const active = gesture.current;
          if (!active || active.pointer !== event.pointerId) return;
          const position = point(event);
          if (active.moving) {
            const original = active.items.find(item => item.id === active.item.id)!;
            active.item = moveMarkup(original, position.x - active.start.x, position.y - active.start.y);
          } else active.item = { ...active.item, points: ["pen", "eraser"].includes(active.item.kind) ? [...active.item.points.slice(0, 8191), position] : [active.start, position] };
          paint(gestureItems());
        }}
        onPointerUp={() => finishStroke()} onPointerCancel={() => finishStroke(true)} onLostPointerCapture={() => finishStroke(true)}
        onPointerLeave={() => setBrushCursor(null)}
        onKeyDown={event => {
          if (busy || !painting) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); event.stopPropagation(); dispatch({ type: "redo" }); }
          if (selected && ["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); dispatch({ type: "commit", items: history.items.filter(item => item.id !== selected) }); setSelected(null); }
        }}
      />
      {brushCursor && painting && !busy && (tool === "Erase" || ["pen", "eraser"].includes(drawingTool)) && <div aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary ring-1 ring-background" style={{ left: `${brushCursor.x}%`, top: `${brushCursor.y}%`, width: brushCursor.diameter, height: brushCursor.diameter }} />}
      {textDraft && <form className="absolute flex w-64 max-w-[calc(100vw-4rem)] items-center gap-1 rounded-xl border bg-popover p-1 shadow-md" style={{ left: `${textDraft.left}%`, top: `${textDraft.top}%` }} onSubmit={event => { event.preventDefault(); addText(); }}>
        <Input autoFocus aria-label="Markup text" placeholder="Add text" value={textDraft.value} maxLength={200} className="min-w-0 flex-1" onChange={event => setTextDraft({ ...textDraft, value: event.target.value })} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setTextDraft(null); } }} />
        <Button type="submit" size="icon-sm" variant="ghost" aria-label="Add text" disabled={!textDraft.value.trim()}><CheckIcon /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel text" onClick={() => setTextDraft(null)}><XIcon /></Button>
      </form>}
      {painting && (tool === "Erase" || !["select", "text"].includes(drawingTool)) && <div className="absolute -left-3 top-1/2 flex h-44 max-h-[max(5rem,100%)] -translate-y-1/2 flex-col items-center rounded-4xl border bg-popover p-3 text-popover-foreground shadow-md">
        <Slider className="[&_[data-slot=slider-control]]:min-h-0" orientation="vertical" aria-label={tool === "Erase" ? "Brush size" : "Stroke width"} min={1} max={tool === "Erase" ? 200 : 40} step={1} value={[size]} onValueChange={value => setSize(Array.isArray(value) ? value[0] : value)} disabled={!!busy} />
      </div>}
    </div>
    <PictureTools>
      {busy ? <><LoaderCircleIcon className="mx-2 size-4 shrink-0 animate-spin" /><span role="status" className="truncate text-sm text-muted-foreground">{busy}</span><Button variant="ghost" size="icon-sm" aria-label="Cancel processing" onClick={() => setDiscard("viewer")}><XIcon /></Button></>
      : tool === "Markup" ? <>
        <ToggleGroup value={[drawingTool]} onValueChange={value => { if (value[0]) { setDrawingTool(value[0] as typeof drawingTool); setSelected(null); } }} size="sm" aria-label="Drawing tools" spacing={0}>
          {[{ value: "select", label: "Select", icon: MousePointer2Icon }, { value: "pen", label: "Pen", icon: PenLineIcon }, { value: "text", label: "Text", icon: TypeIcon }].map(({ value, label, icon: Icon }) => <ToggleGroupItem key={value} value={value} aria-label={label} title={label}><Icon /></ToggleGroupItem>)}
        </ToggleGroup>
        <DropdownMenu open={shapeOpen} onOpenChange={setShapeOpen}><DropdownMenuTrigger render={<Button variant={shapes.some(shape => shape.value === drawingTool) ? "secondary" : "ghost"} size="icon-sm" aria-label="Shapes" title="Shapes" />}><ShapesIcon /></DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center"><DropdownMenuGroup>{shapes.map(({ label, value, icon: Icon }) => <DropdownMenuItem key={value} onClick={() => { setDrawingTool(value); setSelected(null); }}><Icon />{label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        <Popover open={colorOpen} onOpenChange={setColorOpen}><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ink color" title="Ink color" />}><CircleIcon fill={color} style={{ color }} /></PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-auto gap-2 p-3"><PopoverTitle className="sr-only">Ink color</PopoverTitle><Input type="color" aria-label="Ink color" value={color} onChange={event => setColor(event.target.value)} className="w-24" /></PopoverContent>
        </Popover>
        <ToggleGroup value={drawingTool === "eraser" ? ["eraser"] : []} onValueChange={value => { if (value[0]) { setDrawingTool("eraser"); setSelected(null); } }} size="sm" aria-label="Markup eraser"><ToggleGroupItem value="eraser" aria-label="Eraser" title="Erase markup"><EraserIcon /></ToggleGroupItem></ToggleGroup>
        {historyControls}
        <Button variant="ghost" size="icon-sm" aria-label="Cancel markup" title="Cancel markup" onClick={cancel}><XIcon /></Button>
        <Button size="icon-sm" aria-label="Done" title="Done · Add marked image to canvas" disabled={!history.items.length || !!textDraft} onClick={() => void run("Markup")}><CheckIcon /></Button>
      </> : tool === "Erase" ? <>
        {history.items.length || history.past.length || history.future.length ? historyControls : <span className="px-2 text-sm text-muted-foreground">Brush over what you want to remove</span>}
        <Button size="sm" disabled={!history.items.length} onClick={() => void run("Erase")}>Send</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancel erase" title="Cancel" onClick={cancel}><XIcon /></Button>
      </> : <>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => enter("Markup")}><PenLineIcon data-icon="inline-start" />Markup</Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void run("Remove BG")}><ScanIcon data-icon="inline-start" />Remove BG</Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => enter("Erase")}><EraserIcon data-icon="inline-start" />Erase</Button>
        <DropdownMenu open={resizeOpen} onOpenChange={setResizeOpen}><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!ready} aria-label="Resize" />}><PictureInPicture2Icon data-icon="inline-start" />Resize</DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end"><DropdownMenuGroup>{ratios.map(({ label, value, icon: Icon }) => <DropdownMenuItem key={value} onClick={() => void run("Resize", value)}><Icon /><span>{label}</span><span className="ml-auto text-xs text-muted-foreground">{value}</span></DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </>}
    </PictureTools>
    <Dialog open={!!discard} onOpenChange={open => { if (!open) setDiscard(null); }}>
      <DialogContent showCloseButton={false}><DialogHeader><DialogTitle>{busy ? "Stop editing?" : "Discard changes?"}</DialogTitle><DialogDescription>{busy ? "The request will be cancelled where supported. The provider may still finish work already submitted." : "Your changes won’t be saved."}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" autoFocus onClick={() => setDiscard(null)}>Keep editing</Button><Button variant="destructive" onClick={() => { const closeViewer = discard === "viewer"; job.current?.abort(); reset(); setTool(null); setDiscard(null); if (closeViewer) onClose(); }}>Discard changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
