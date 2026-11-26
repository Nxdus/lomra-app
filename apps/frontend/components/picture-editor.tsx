"use client";

import { Tip } from "@/components/tip";
import { BackgroundCleanup } from "@/components/background-cleanup";
import { useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState, type PointerEvent, type Ref } from "react";
import { ArrowRightIcon, CheckIcon, CircleIcon, EraserIcon, LoaderCircleIcon, Maximize2Icon, MinusIcon, MousePointer2Icon, PenLineIcon, PictureInPicture2Icon, Redo2Icon, ScanIcon, ShapesIcon, SquareIcon, TypeIcon, Undo2Icon, XIcon } from "lucide-react";
import { PictureTools, type PictureTool } from "@/components/picture-tools";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ModelSetupDialog } from "@/components/first-run/model-setup-dialog";
import { useApiProviders } from "@/components/api-provider";
import { isBrowserModel, isLocalPictureModel, isSdModel, generate, modelProvider, pictureAiPrefix, sdPrefix, selectedModel } from "@/components/prompt/generation";
import { downloadPictureAiModel } from "@/hooks/use-picture-ai";
import { desktopPictureAi, type PictureAiModel } from "@/lib/desktop";
import { localModelSize } from "@/components/ollama-settings";
import { useSd } from "@/hooks/use-sd";
import { pictureCapabilities } from "@/lib/picture-capabilities";
import { getSetting } from "@/lib/settings";
import type { CanvasProvenance } from "@/lib/image-canvas/canvas-harness";
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

// A model without instructions to follow only fills an area well when it starts from noise and is asked for nothing in particular.
const sdErase = {
  prompt: "plain empty background, natural continuation, nothing there",
  settings: { negativePrompt: "object, person, animal, text, watermark, frame, border", strength: 1 },
};

function surface(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = width; result.height = height;
  if (!result.getContext("2d")) throw new Error("Image editing is unavailable in this browser.");
  return result;
}

export type PictureEditorHandle = { requestClose: (escape?: boolean) => boolean };

export function PictureEditor({ ref, url, name, onSave, onClose }: { ref?: Ref<PictureEditorHandle>; url: string; name: string; onSave: (file: File, provenance?: CanvasProvenance) => Promise<void>; onClose: () => void }) {
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
  const [editPrompt, setEditPrompt] = useState("");
  const [discard, setDiscard] = useState<"mode" | "viewer" | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ message: string; retryable: boolean }>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [startingDownload, setStartingDownload] = useState(false);
  const notNow = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [cleanup, setCleanup] = useState<{ original: HTMLCanvasElement; cutout: HTMLCanvasElement; provenance?: CanvasProvenance } | null>(null);
  const [color, setColor] = useState("#ef4444");
  const [size, setSize] = useState(4);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const [pictureChoice, setPictureChoice] = useState<{ action: "Remove BG" | "Upscale"; scale?: 2 | 4; model: PictureAiModel } | null>(null);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [pictureModel, setPictureModel] = useState("");
  const [findingModel, setFindingModel] = useState(false);
  const { status: sdStatus, refresh: refreshSd } = useSd();
  const caps = pictureModel ? pictureCapabilities(pictureModel, sdStatus) : undefined;
  const eraseBlocked = !!caps && !caps.inpaint;
  const resizeBlocked = !!caps && !caps.outpaint;
  const eraseUnavailableMessage = "This image model cannot edit a brushed area. Choose another Image model in the prompt toolbar.";
  const resizeUnavailableMessage = pictureModel && isSdModel(pictureModel)
    ? "Local Stable Diffusion cannot extend a picture to a new shape. Choose another Image model in the prompt toolbar."
    : "This image model cannot extend a picture to a new shape. Choose another Image model in the prompt toolbar.";
  const localModel = isSdModel(pictureModel) ? sdStatus?.models.find(model => model.installed && `${sdPrefix}${model.id}` === pictureModel) : undefined;
  const inpaintModel = sdStatus?.models.find(model => model.installed && model.inpaint);
  const dirty = history.items.length > 0 || !!textDraft?.value.trim() || !!editPrompt.trim();
  const painting = tool === "Markup" || tool === "Erase";

  useImperativeHandle(ref, () => ({ requestClose(escape) {
    if (escape) {
      if (colorOpen) { setColorOpen(false); return false; }
      if (shapeOpen) { setShapeOpen(false); return false; }
      if (resizeOpen) { setResizeOpen(false); return false; }
      if (upscaleOpen) { setUpscaleOpen(false); return false; }
      if (textDraft) { cancelText(); return false; }
      if (!job.current && cleanup) { setDiscard("mode"); return false; }
      if (!job.current && tool) { cancel(); return false; }
    }
    if (cleanup && job.current) return false;
    if (dirty || cleanup || job.current) { setDiscard("viewer"); return false; }
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
        if (bitmap.width * bitmap.height > 16_000_000) {
          setLoadFailure({ message: "Editing supports pictures up to 16 megapixels.", retryable: false });
          return;
        }
        source.current = surface(bitmap.width, bitmap.height);
        source.current.getContext("2d")!.drawImage(bitmap, 0, 0);
        overlay.current!.width = bitmap.width; overlay.current!.height = bitmap.height;
        setReady(true);
      } finally { bitmap.close(); }
    })().catch(cause => {
      if (!controller.signal.aborted) setLoadFailure({ message: cause instanceof Error && cause.message ? cause.message : "Could not load picture.", retryable: true });
    });
    return () => { controller.abort(); job.current?.abort(); };
  }, [url, loadAttempt]);

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
    setEditPrompt("");
  }

  const loadPictureModel = useCallback(async () => {
    try {
      const models = await getSetting<string[]>("selected-models");
      setPictureModel(selectedModel(models ?? [], "picture") ?? "");
    } catch { /* The edit itself reports what is wrong. */ }
  }, []);

  useEffect(() => {
    let active = true;
    void getSetting<string[]>("selected-models").then((models) => {
      if (active) setPictureModel(selectedModel(models ?? [], "picture") ?? "");
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  function enter(next: "Markup" | "Erase") {
    reset(); setTool(next); setDrawingTool("pen"); setSize(next === "Erase" ? 70 : 4);
    if (next === "Erase") void checkModel();
  }

  /** Which model will edit the brushed area, to say so when it was not made for that. */
  async function checkModel() {
    await Promise.all([loadPictureModel(), refreshSd().catch(() => undefined)]);
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

  function cancelText() {
    setTextDraft(null);
    overlay.current?.focus();
  }

  function addText() {
    if (!textDraft?.value.trim()) { setTextDraft(null); return; }
    dispatch({ type: "commit", items: [...history.items, { id: crypto.randomUUID(), kind: "text", points: [{ x: textDraft.x, y: textDraft.y }], color, width: size, text: textDraft.value.trim() }] });
    setTextDraft(null);
  }

  async function exportResult(result: HTMLCanvasElement, signal: AbortSignal, provenance?: CanvasProvenance) {
    const blob = await new Promise<Blob>((resolve, reject) => result.toBlob(value => value ? resolve(value) : reject(new Error("Could not export picture.")), "image/png"));
    signal.throwIfAborted();
    await onSave(new File([blob], `${name.replace(/\.[^.]+$/, "")}-edited.png`, { type: "image/png" }), provenance);
  }

  async function saveCutout(result: HTMLCanvasElement) {
    if (job.current) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy("Saving…");
    try {
      await exportResult(result, controller.signal, cleanup?.provenance);
      if (!controller.signal.aborted) setCleanup(null);
    } catch (cause) {
      if (!controller.signal.aborted) error(cause);
    } finally {
      if (!controller.signal.aborted) { setBusy(""); job.current = null; }
    }
  }

  async function startPictureTool(action: "Remove BG" | "Upscale", scale?: 2 | 4) {
    if (!ready || job.current) return;
    const bridge = desktopPictureAi();
    if (!bridge) {
      await run(action, undefined, "", scale);
      return;
    }
    try {
      const status = await bridge.status();
      const op = action === "Remove BG" ? "remove-background" : "upscale";
      const local = status.models.find(m => m.operation === op);
      if (!local) {
        await run(action, undefined, "", scale);
        return;
      }
      if (local.installed) {
        await run(action, undefined, "", scale, `${pictureAiPrefix}${local.id}`);
        return;
      }
      setPictureChoice({ action, scale, model: local });
    } catch (cause) {
      error(cause);
    }
  }

  async function run(action: PictureTool, aspectRatio?: string, edit = "", scale?: 2 | 4, localPictureModel?: string, downloadBefore?: PictureAiModel) {
    if (!ready || job.current) return;
    const controller = new AbortController(); job.current = controller;
    setBusy(downloadBefore ? "Starting…" : action === "Markup" ? "Adding markup…" : "Generating");
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
        const upscale = action === "Upscale";
        if (downloadBefore) {
          const bridge = desktopPictureAi();
          if (!bridge) throw new Error("Local picture tools require the Lomra desktop app.");
          await downloadPictureAiModel(bridge, downloadBefore.id, downloadBefore.name, controller.signal, status => {
            if (controller.signal.aborted) return;
            setStartingDownload(false);
            setPictureChoice(null);
            setBusy(status);
          });
          controller.signal.throwIfAborted();
          setStartingDownload(false);
          setPictureChoice(null);
          setBusy("Generating");
        }
        if (action === "Erase" && !history.items.length) throw new Error("Brush over the area you want to change first.");
        const model = localPictureModel ?? (background ? "fal-ai/birefnet/v2" : upscale ? "fal-ai/esrgan" : selectedModel(await getSetting<string[]>("selected-models") ?? [], "picture"));
        controller.signal.throwIfAborted();
        if (!model) throw new Error("Select an Image model in the prompt toolbar first.");
        const keyProvider = background || upscale ? "fal" : modelProvider(model ?? "");
        if (!isBrowserModel(model ?? "") && !isSdModel(model ?? "") && !isLocalPictureModel(model ?? "") && !keys[keyProvider]) throw new Error(`Enter your ${{ fal: "Fal.AI", google: "Google", openrouter: "OpenRouter" }[keyProvider]} API key in Settings first.`);
        const local = !background && !upscale && isSdModel(model);
        const runCaps = !background && !upscale ? pictureCapabilities(model, sdStatus) : undefined;
        if (runCaps && action === "Resize" && !runCaps.outpaint) {
          throw new Error(local
            ? "Local Stable Diffusion cannot extend a picture to a new shape. Choose another Image model in the prompt toolbar."
            : "This image model cannot extend a picture to a new shape. Choose another Image model in the prompt toolbar.");
        }
        if (runCaps && action === "Erase" && !runCaps.inpaint) throw new Error(eraseUnavailableMessage);
        const references = [original.toDataURL("image/png")];
        const selection = action === "Erase" ? surface(original.width, original.height) : null;
        if (selection) {
          const mask = selection.getContext("2d")!;
          drawMarkup(mask, history.items);
          const guide = surface(original.width, original.height), ctx = guide.getContext("2d")!;
          ctx.drawImage(original, 0, 0); ctx.globalAlpha = 0.55; ctx.drawImage(selection, 0, 0);
          drawMarkup(mask, history.items.map(item => ({ ...item, color: "white" })));
          if (!local) references.push(guide.toDataURL("image/png"), selection.toDataURL("image/png"));
        }
        const prompt = background ? "Remove background" : upscale ? `Upscale ${scale ?? 2}x` : local ? edit || sdErase.prompt : action === "Resize"
          ? `Recompose this image into a ${aspectRatio} aspect ratio. Preserve the subject, identity, style, lighting and details. Naturally extend the scene or rearrange surrounding space to fit the new composition. Do not stretch the image, add letterboxing or crop away the main subject.`
          : `Edit image 1. Image 2 highlights the selection. Image 3 is a selection guide (white is selected). ${edit ? `Apply this instruction only within the selection: ${edit}` : "Remove the selected objects and naturally reconstruct the background from surrounding context."}\nReturn only the clean image at the original dimensions. Never render the mask, selection overlay, borders, frames, outlines or letterboxing. Preserve the composition and every unselected area.`;
        const eraseSettings = {
          ...(runCaps?.negativePrompt ? { negativePrompt: sdErase.settings.negativePrompt } : {}),
          ...(runCaps?.strength ? { strength: sdErase.settings.strength } : {}),
        };
        let sd: CanvasProvenance["sd"];
        const mediaTool = background ? { name: "remove_background" as const, image_index: 0 } : upscale ? { name: "upscale_image" as const, image_index: 0, scale: scale ?? 2 } : undefined;
        const files = await generate({ id: crypto.randomUUID(), category: "picture", prompt, model, status: "Waiting", ...(local && selection ? { sdEdit: { mask: selection.toDataURL("image/png"), ...(edit ? {} : eraseSettings) } } : {}), ...(aspectRatio ? { aspectRatio } : {}), ...(mediaTool ? { mediaTool } : {}) }, request, controller.signal, change => { if (change.sd) sd = change.sd; if (change.status && !controller.signal.aborted) setBusy(change.status); }, references[0], references);
        const response = await fetch(files[0].url, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not download the processed picture.");
        const blob = await response.blob();
        if (upscale) {
          controller.signal.throwIfAborted();
          await onSave(new File([blob], `${name.replace(/\.[^.]+$/, "")}-upscaled-${scale ?? 2}x.png`, { type: "image/png" }), { model, prompt });
        } else {
          const bitmap = await createImageBitmap(blob);
          try {
            controller.signal.throwIfAborted();
            if (bitmap.width * bitmap.height > 16_000_000) throw new Error("Processed picture is too large.");
            if (aspectRatio) {
              const [w, h] = aspectRatio.split(":").map(Number);
              if (Math.abs(bitmap.width / bitmap.height / (w / h) - 1) > 0.03) throw new Error("The selected model did not return the requested aspect ratio. Try another Image model.");
            }
            const result = selection ? surface(original.width, original.height) : surface(bitmap.width, bitmap.height);
            const ctx = result.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0, result.width, result.height);
            if (background) {
              setCleanup({ original, cutout: result, provenance: { model, prompt } });
              return;
            }
            if (selection) {
              // Only accept generated pixels inside the brush mask, including its antialiased edge.
              ctx.globalCompositeOperation = "destination-in";
              ctx.drawImage(selection, 0, 0);
              ctx.globalCompositeOperation = "destination-over";
              ctx.drawImage(original, 0, 0);
              ctx.globalCompositeOperation = "source-over";
            }
            await exportResult(result, controller.signal, (aspectRatio || sd) ? { model, prompt, ...(aspectRatio ? { aspectRatio } : {}), ...(sd ? { sd } : {}) } : undefined);
          } finally { bitmap.close(); }
        }
      }
      if (!controller.signal.aborted) { reset(); setTool(null); }
    } catch (cause) { if (!controller.signal.aborted) error(cause); }
    finally {
      if (!controller.signal.aborted) {
        if (downloadBefore) { setStartingDownload(false); setPictureChoice(null); }
        setBusy("");
        job.current = null;
      }
    }
  }

  const historyControls = <>
    <Tip label="Undo · Ctrl/⌘ Z"><Button type="button" variant="ghost" size="icon-sm" aria-label="Undo" disabled={!history.past.length || !!busy} onClick={() => dispatch({ type: "undo" })}><Undo2Icon /></Button></Tip>
    <Tip label="Redo · Ctrl/⌘ Shift Z"><Button type="button" variant="ghost" size="icon-sm" aria-label="Redo" disabled={!history.future.length || !!busy} onClick={() => dispatch({ type: "redo" })}><Redo2Icon /></Button></Tip>
  </>;

  return <>
    {cleanup && <BackgroundCleanup {...cleanup} saving={!!busy} onSave={saveCutout} onCancel={() => setDiscard("mode")} />}
    <div className={cn("relative mx-auto w-fit max-w-full", !ready && "min-h-32", cleanup && "hidden")}>
      {/* Local blob URLs need no Next.js image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name || "Image preview"} className="block max-h-[min(80dvh,calc(var(--app-content-height)-5rem))] max-w-full rounded-4xl object-contain" />
      {!ready && (loadFailure ? (
        <Alert variant="destructive" className="absolute top-4 left-1/2 w-[min(22rem,calc(100vw-5rem))] -translate-x-1/2 bg-background">
          <AlertTitle>Could not prepare picture</AlertTitle>
          <AlertDescription>{loadFailure.message}</AlertDescription>
          {loadFailure.retryable && <Button variant="outline" size="sm" className="w-fit" onClick={() => { setLoadFailure(undefined); setLoadAttempt(value => value + 1); }}>Retry</Button>}
        </Alert>
      ) : <p role="status" className="absolute top-4 left-1/2 w-max -translate-x-1/2 rounded-xl bg-popover px-3 py-2 text-sm text-muted-foreground">Preparing picture…</p>)}
      <canvas ref={overlay} tabIndex={painting ? 0 : -1} aria-label={tool === "Markup" ? "Draw on image" : tool === "Erase" ? "Brush over the area to edit" : undefined} aria-hidden={!painting} className={cn("absolute inset-0 size-full outline-none focus-visible:ring-2 focus-visible:ring-ring", painting && !busy ? "touch-none cursor-crosshair" : "pointer-events-none", tool === "Markup" && drawingTool === "select" && "cursor-default", tool === "Erase" && "opacity-50")}
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
        <Input autoFocus aria-label="Markup text" placeholder="Add text" value={textDraft.value} maxLength={200} className="min-w-0 flex-1" onChange={event => setTextDraft({ ...textDraft, value: event.target.value })} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelText(); } }} />
        <Tip label="Add text"><Button type="submit" size="icon-sm" variant="ghost" aria-label="Add text" disabled={!textDraft.value.trim()}><CheckIcon /></Button></Tip>
        <Tip label="Cancel text"><Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel text" onClick={cancelText}><XIcon /></Button></Tip>
      </form>}
      {painting && (tool === "Erase" || !["select", "text"].includes(drawingTool)) && <div className="absolute -left-3 top-1/2 flex h-44 max-h-[max(5rem,100%)] -translate-y-1/2 flex-col items-center rounded-4xl border bg-popover p-3 text-popover-foreground shadow-md">
        <Slider className="[&_[data-slot=slider-control]]:min-h-0" orientation="vertical" aria-label={tool === "Erase" ? "Brush size" : "Stroke width"} min={1} max={tool === "Erase" ? 200 : 40} step={1} value={[size]} onValueChange={value => setSize(Array.isArray(value) ? value[0] : value)} disabled={!!busy} />
      </div>}
    </div>
    {!cleanup && <PictureTools>
      {busy ? <><LoaderCircleIcon aria-hidden="true" className="mx-2 size-4 shrink-0 motion-safe:animate-spin" /><span role="status" className="truncate text-sm text-muted-foreground">{busy}</span><Tip label="Stop editing"><Button variant="ghost" size="icon-sm" aria-label="Stop editing" onClick={() => setDiscard("mode")}><SquareIcon /></Button></Tip></>
      : tool === "Markup" ? <>
        <ToggleGroup value={[drawingTool]} onValueChange={value => { if (value[0]) { setDrawingTool(value[0] as typeof drawingTool); setSelected(null); } }} size="sm" aria-label="Drawing tools" spacing={0}>
          {[{ value: "select", label: "Select", icon: MousePointer2Icon }, { value: "pen", label: "Pen", icon: PenLineIcon }, { value: "text", label: "Text", icon: TypeIcon }].map(({ value, label, icon: Icon }) => <Tip key={value} label={label}><ToggleGroupItem value={value} aria-label={label}><Icon /></ToggleGroupItem></Tip>)}
        </ToggleGroup>
        <DropdownMenu open={shapeOpen} onOpenChange={setShapeOpen}><Tip label="Shapes"><DropdownMenuTrigger render={<Button variant={shapes.some(shape => shape.value === drawingTool) ? "secondary" : "ghost"} size="icon-sm" aria-label="Shapes" />}><ShapesIcon /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent side="top" align="center"><DropdownMenuGroup>{shapes.map(({ label, value, icon: Icon }) => <DropdownMenuItem key={value} onClick={() => { setDrawingTool(value); setSelected(null); }}><Icon />{label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        <Popover open={colorOpen} onOpenChange={setColorOpen}><Tip label="Ink color"><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ink color" />}><CircleIcon fill={color} style={{ color }} /></PopoverTrigger></Tip>
          <PopoverContent side="top" align="center" className="w-auto gap-2 p-3"><PopoverTitle className="sr-only">Ink color</PopoverTitle><Input type="color" aria-label="Ink color" value={color} onChange={event => setColor(event.target.value)} className="w-24" /></PopoverContent>
        </Popover>
        <ToggleGroup value={drawingTool === "eraser" ? ["eraser"] : []} onValueChange={value => { if (value[0]) { setDrawingTool("eraser"); setSelected(null); } }} size="sm" aria-label="Markup eraser"><Tip label="Erase markup"><ToggleGroupItem value="eraser" aria-label="Eraser"><EraserIcon /></ToggleGroupItem></Tip></ToggleGroup>
        {historyControls}
        <Tip label="Cancel markup"><Button variant="ghost" size="icon-sm" aria-label="Cancel markup" onClick={cancel}><XIcon /></Button></Tip>
        <Tip label="Done · Add marked image to canvas"><Button size="icon-sm" aria-label="Done" disabled={!history.items.length || !!textDraft} onClick={() => void run("Markup")}><CheckIcon /></Button></Tip>
      </> : tool === "Erase" ? <form className="flex w-80 min-w-0 flex-col gap-1" onSubmit={event => {
        event.preventDefault();
        if (history.items.length && editPrompt.trim()) void run("Erase", undefined, editPrompt.trim());
      }}>
        <Input aria-label="Describe the edit" placeholder="e.g. Change the shirt to green" maxLength={7500} value={editPrompt} onChange={event => setEditPrompt(event.target.value)} />
        {localModel && !localModel.inpaint && <p className="px-2 pt-0.5 text-xs text-muted-foreground">
          {inpaintModel ? <>Edges may show. <span className="break-all">{inpaintModel.name}</span> blends better: choose it as the Image model.</>
            : <>Edges may show with this model. <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setFindingModel(true)}>Get an inpainting model</Button></>}
        </p>}
        <div className="flex flex-wrap items-center gap-1">
          {history.items.length || history.past.length || history.future.length ? historyControls : <span className="py-1 text-sm text-muted-foreground">Brush over the area to change</span>}
          <Button className="ml-auto" type="button" variant="secondary" size="sm" disabled={!history.items.length} onClick={() => void run("Erase")}>Erase</Button>
          <Button type="submit" size="sm" disabled={!history.items.length || !editPrompt.trim()}>Apply edit</Button>
          <Tip label="Cancel"><Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel erase" onClick={cancel}><XIcon /></Button></Tip>
        </div>
      </form> : <>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => enter("Markup")}><PenLineIcon data-icon="inline-start" />Markup</Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void startPictureTool("Remove BG")}><ScanIcon data-icon="inline-start" />Remove BG</Button>
        <DropdownMenu open={upscaleOpen} onOpenChange={setUpscaleOpen}><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!ready} aria-label="Upscale" />}><Maximize2Icon data-icon="inline-start" />Upscale</DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center"><DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void startPictureTool("Upscale", 2)}><span>Upscale 2×</span><span className="ml-auto text-xs text-muted-foreground">2×</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => void startPictureTool("Upscale", 4)}><span>Upscale 4×</span><span className="ml-auto text-xs text-muted-foreground">4×</span></DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        {eraseBlocked ? (
          <Tip label={eraseUnavailableMessage}><span className="inline-flex"><Button variant="ghost" size="sm" disabled><EraserIcon data-icon="inline-start" />Erase</Button></span></Tip>
        ) : (
          <Button variant="ghost" size="sm" disabled={!ready} onClick={() => enter("Erase")}><EraserIcon data-icon="inline-start" />Erase</Button>
        )}
        {resizeBlocked ? (
          <Tip label={resizeUnavailableMessage}><span className="inline-flex"><Button variant="ghost" size="sm" disabled aria-label="Resize"><PictureInPicture2Icon data-icon="inline-start" />Resize</Button></span></Tip>
        ) : (
          <DropdownMenu open={resizeOpen} onOpenChange={setResizeOpen}><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!ready} aria-label="Resize" />}><PictureInPicture2Icon data-icon="inline-start" />Resize</DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end"><DropdownMenuGroup>{ratios.map(({ label, value, icon: Icon }) => <DropdownMenuItem key={value} onClick={() => void run("Resize", value)}><Icon /><span>{label}</span><span className="ml-auto text-xs text-muted-foreground">{value}</span></DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
          </DropdownMenu>
        )}
      </>}
    </PictureTools>}
    {/* Nested, so the brushed area and the words stay as they are. */}
    <ModelSetupDialog open={findingModel} onOpenChange={open => { setFindingModel(open); if (!open) void checkModel(); }} imageSearch="stable-diffusion inpainting" />
    <Dialog open={!!pictureChoice} onOpenChange={open => { if (!open && !startingDownload) setPictureChoice(null); }}>
      {pictureChoice && <DialogContent showCloseButton={false} initialFocus={notNow}>
        <DialogHeader>
          <DialogTitle>Download {pictureChoice.model.name}?</DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            <span>{pictureChoice.model.note}</span>
            <span className="text-xs">{pictureChoice.model.bytes ? `Size: ${localModelSize(pictureChoice.model.bytes)}` : "Size unavailable"} · License: {pictureChoice.model.license}. Runs locally on your computer without an API key.</span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {keys.fal && <Button variant="secondary" disabled={startingDownload} className="sm:mr-auto" onClick={() => {
            const { action, scale } = pictureChoice;
            setPictureChoice(null);
            void run(action, undefined, "", scale);
          }}>Use Fal.AI</Button>}
          <Button ref={notNow} variant="outline" disabled={startingDownload} onClick={() => setPictureChoice(null)}>Not now</Button>
          <Button disabled={startingDownload} onClick={() => {
            const { action, scale, model } = pictureChoice;
            setStartingDownload(true);
            void run(action, undefined, "", scale, `${pictureAiPrefix}${model.id}`, model);
          }}>{startingDownload ? "Starting…" : "Download"}</Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
    <Dialog open={!!discard} onOpenChange={open => { if (!open) setDiscard(null); }}>
      <DialogContent showCloseButton={false}><DialogHeader><DialogTitle>{busy ? "Stop editing?" : "Discard changes?"}</DialogTitle><DialogDescription>{busy ? "The request will be cancelled where supported. The provider may still finish work already submitted." : "Your changes won’t be saved."}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" autoFocus onClick={() => setDiscard(null)}>Keep editing</Button><Button variant="destructive" onClick={() => { const closeViewer = discard === "viewer"; job.current?.abort(); job.current = null; setBusy(""); if (busy) toast.add({ title: "Editing stopped" }); reset(); setTool(null); setCleanup(null); setDiscard(null); if (closeViewer) onClose(); }}>{busy ? "Stop editing" : "Discard changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
