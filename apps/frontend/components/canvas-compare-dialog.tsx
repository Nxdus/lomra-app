"use client";

import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Columns2Icon, MoveHorizontalIcon, RotateCcwIcon, SlidersHorizontalIcon, SparklesIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import type { VisibleImage } from "@/components/image-canvas";
import { isLocal3dModel, isSdModel, local3dPrefix, sdPrefix } from "@/components/prompt/generation";
import { Tip } from "@/components/tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocal3d } from "@/hooks/use-local3d";
import { useSd } from "@/hooks/use-sd";
import { hostedPictureToolNames, isLocalPictureModel, pictureAiPrefix } from "@/components/prompt/media-tools";
import { usePictureAi } from "@/hooks/use-picture-ai";
import { canUsePictureSetup, comparePictures } from "@/lib/image-canvas/provenance-setup";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const itemTitle = (item: VisibleImage) => item.harness?.title ?? item.file.name;

/** Side-by-side and before/after slider comparison for 2 to 4 selected canvas pictures. */
export function CanvasCompareDialog({ items, onClose, onUseSetup, busy = false }: {
  items: VisibleImage[];
  onClose: () => void;
  onUseSetup?: (item: VisibleImage) => void;
  busy?: boolean;
}) {
  const canSlide = items.length === 2;
  const [mode, setMode] = useState<"side-by-side" | "slider">("side-by-side");
  const activeMode = canSlide ? mode : "side-by-side";
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [split, setSplit] = useState(50);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [previews, setPreviews] = useState<Record<string, { attempt: number; failed: boolean }>>({});
  const splitReady = items.every(item => sizes[item.id] && !previews[item.id]?.failed);
  const dragPan = useRef<{ pointer: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const dragSplit = useRef<number | null>(null);
  const sliderStage = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const sd = useSd();
  const local3d = useLocal3d();
  const pictureAi = usePictureAi();

  const resolveModelName = useCallback((model: string) => {
    if (isSdModel(model)) return sd.status?.models.find((m) => m.id === model.slice(sdPrefix.length))?.name;
    if (isLocal3dModel(model)) return local3d.status?.models.find((m) => m.id === model.slice(local3dPrefix.length))?.name;
    if (isLocalPictureModel(model)) return pictureAi.status?.models.find(m => m.id === model.slice(pictureAiPrefix.length))?.name;
    return Object.hasOwn(hostedPictureToolNames, model) ? hostedPictureToolNames[model] : undefined;
  }, [sd.status, local3d.status, pictureAi.status]);

  const rows = useMemo(() => comparePictures(
    items.map((item) => ({
      id: item.id,
      name: itemTitle(item),
      provenance: item.harness?.provenance,
      naturalWidth: sizes[item.id]?.width,
      naturalHeight: sizes[item.id]?.height,
    })),
    resolveModelName,
  ), [items, sizes, resolveModelName]);

  const visibleRows = useMemo(
    () => rows.filter((row) => row.hasValue || row.differs || row.id === "size"),
    [rows],
  );
  const hasAnyProvenance = items.some((item) => !!item.harness?.provenance);

  function previewImage(item: VisibleImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={previews[item.id]?.attempt ?? 0} src={item.url} alt={itemTitle(item)} draggable={false}
        style={imageTransformStyle} className={cn("size-full object-contain", previews[item.id]?.failed && "invisible")}
        onLoad={(event) => recordSize(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
        onError={() => setPreviews(current => ({ ...current, [item.id]: { attempt: current[item.id]?.attempt ?? 0, failed: true } }))} />
    );
  }

  function previewStatus(item: VisibleImage) {
    if (previews[item.id]?.failed) return (
      <div className="pointer-events-auto flex size-full min-h-24 flex-col items-center justify-center gap-2 bg-muted p-3 text-center text-sm">
        <p role="alert">Could not load {itemTitle(item)}</p>
        <Button variant="outline" size="sm" onClick={() => {
          setSizes(current => {
            const next = { ...current };
            delete next[item.id];
            return next;
          });
          setPreviews(current => ({ ...current, [item.id]: { failed: false, attempt: (current[item.id]?.attempt ?? 0) + 1 } }));
        }}>Retry</Button>
      </div>
    );
    if (!sizes[item.id]) return <Skeleton className="size-full motion-reduce:animate-none" role="status" aria-label={`Loading ${itemTitle(item)}`} />;
  }

  function setZoomSynced(next: number) {
    const clamped = clamp(Math.round(next * 100) / 100, MIN_ZOOM, MAX_ZOOM);
    setZoom(clamped);
    if (clamped <= 1) setPan({ x: 0, y: 0 });
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function onViewportWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.002);
    setZoomSynced(zoom * factor);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= 1 || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    dragPan.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const active = dragPan.current;
    if (!active || active.pointer !== event.pointerId) return;
    setPan({ x: active.originX + (event.clientX - active.x), y: active.originY + (event.clientY - active.y) });
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (dragPan.current?.pointer === event.pointerId) dragPan.current = null;
  }

  function updateSplitFromClientX(clientX: number) {
    const rect = sliderStage.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setSplit(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100));
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (activeMode === "slider" && !splitReady) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoomSynced(zoom + 0.5);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoomSynced(zoom - 0.5);
    } else if (event.key === "0") {
      event.preventDefault();
      resetView();
    }
  }

  function handleViewportKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (zoom <= 1 || event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 40 : 16;
    const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    setPan((current) => ({ x: current.x + delta[0], y: current.y + delta[1] }));
  }

  function handleSliderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setSplit((value) => clamp(value - step, 0, 100));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setSplit((value) => clamp(value + step, 0, 100));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSplit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSplit(100);
    }
  }

  const imageTransformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: "center center",
  };

  const recordSize = (id: string, width: number, height: number) => {
    setSizes((current) => (current[id]?.width === width && current[id]?.height === height ? current : { ...current, [id]: { width, height } }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-labelledby={headingId}
        onKeyDown={handleDialogKeyDown}
        className="max-h-[calc(var(--app-content-height)-2rem)] w-full gap-4 sm:max-w-[calc(100vw-3rem)]"
      >
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-3 pr-10">
          <div>
            <DialogTitle id={headingId}>Compare {items.length} pictures</DialogTitle>
            <DialogDescription>
              Scroll or press + / − to zoom in sync. Arrow keys pan when zoomed.
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSlide && (
              <Tabs value={activeMode} onValueChange={(value) => { if (value === "side-by-side" || value === "slider") setMode(value); }}>
                <TabsList aria-label="Comparison mode">
                  <TabsTrigger value="side-by-side"><Columns2Icon />Side by side</TabsTrigger>
                  <TabsTrigger value="slider"><SlidersHorizontalIcon />Slider</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <div className="flex items-center gap-1 rounded-4xl border bg-muted/40 p-1" role="group" aria-label="Zoom controls">
              <Tip label="Zoom out (-)">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Zoom out" disabled={(activeMode === "slider" && !splitReady) || zoom <= MIN_ZOOM} onClick={() => setZoomSynced(zoom - 0.5)}>
                  <ZoomOutIcon />
                </Button>
              </Tip>
              <span className="min-w-12 text-center text-xs font-medium tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Tip label="Zoom in (+)">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Zoom in" disabled={(activeMode === "slider" && !splitReady) || zoom >= MAX_ZOOM} onClick={() => setZoomSynced(zoom + 0.5)}>
                  <ZoomInIcon />
                </Button>
              </Tip>
              <Tip label="Reset zoom (0)">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Reset zoom" disabled={(activeMode === "slider" && !splitReady) || (zoom === 1 && pan.x === 0 && pan.y === 0)} onClick={resetView}>
                  <RotateCcwIcon />
                </Button>
              </Tip>
            </div>
          </div>
        </DialogHeader>

        {activeMode === "slider" && canSlide ? (
          <div className="flex flex-col gap-3">
            <div
              ref={sliderStage}
              tabIndex={0}
              role="region"
              aria-label={`Before and after comparison: ${itemTitle(items[0])} and ${itemTitle(items[1])}`}
              onWheel={splitReady ? onViewportWheel : undefined}
              onKeyDown={splitReady ? handleViewportKeyDown : undefined}
              onPointerDown={(event) => {
                if (!splitReady || (event.target as HTMLElement).closest("[data-split-handle]")) return;
                if (zoom > 1) { startPan(event); return; }
                if (!event.isPrimary || event.button !== 0) return;
                event.preventDefault();
                dragSplit.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSplitFromClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (dragSplit.current === event.pointerId) { updateSplitFromClientX(event.clientX); return; }
                movePan(event);
              }}
              onPointerUp={(event) => {
                if (dragSplit.current === event.pointerId) dragSplit.current = null;
                endPan(event);
              }}
              onPointerCancel={(event) => {
                if (dragSplit.current === event.pointerId) dragSplit.current = null;
                endPan(event);
              }}
              className={cn(
                "relative h-[min(48vh,28rem)] w-full overflow-hidden rounded-2xl border bg-muted/40 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
                zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-ew-resize",
              )}
            >
              {/* Left (before) picture */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                {previewImage(items[0])}
              </div>
              {/* Right (after) picture */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                {previewImage(items[1])}
              </div>
              <Badge variant="secondary" className="pointer-events-none absolute top-3 left-3 max-w-[40%] truncate">{itemTitle(items[0])}</Badge>
              <Badge variant="secondary" className="pointer-events-none absolute top-3 right-3 max-w-[40%] truncate">{itemTitle(items[1])}</Badge>
              {!splitReady && <div className="pointer-events-none absolute inset-0 grid grid-cols-2">
                {items.map(item => <div key={item.id} className="min-w-0">{previewStatus(item)}</div>)}
              </div>}
              {splitReady && <div
                data-split-handle
                role="slider"
                tabIndex={0}
                aria-label="Comparison split"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                aria-valuetext={`${Math.round(split)}%`}
                onKeyDown={handleSliderKeyDown}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  dragSplit.current = event.pointerId;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (dragSplit.current === event.pointerId) updateSplitFromClientX(event.clientX);
                }}
                onPointerUp={(event) => {
                  if (dragSplit.current === event.pointerId) dragSplit.current = null;
                }}
                onPointerCancel={(event) => {
                  if (dragSplit.current === event.pointerId) dragSplit.current = null;
                }}
                style={{ left: `${split}%` }}
                className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-foreground shadow-md">
                  <MoveHorizontalIcon className="size-4" aria-hidden="true" />
                </span>
              </div>}
            </div>
          </div>
        ) : (
          <div className={cn(
            "grid gap-3",
            items.length === 2 ? "grid-cols-1 sm:grid-cols-2" : items.length === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
          )}>
            {items.map((item) => (
              <div key={item.id} className="flex min-w-0 flex-col gap-2">
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium" title={itemTitle(item)}>{itemTitle(item)}</span>
                  {canUsePictureSetup(item.harness?.provenance) && onUseSetup && (
                    <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => { onUseSetup(item); onClose(); }}>
                      <SparklesIcon data-icon="inline-start" />Use this setup
                    </Button>
                  )}
                </div>
                <div
                  tabIndex={0}
                  role="region"
                  aria-label={`${itemTitle(item)} zoom ${Math.round(zoom * 100)}%`}
                  onWheel={onViewportWheel}
                  onPointerDown={startPan}
                  onPointerMove={movePan}
                  onPointerUp={endPan}
                  onPointerCancel={endPan}
                  onKeyDown={handleViewportKeyDown}
                  className={cn(
                    "relative h-64 w-full overflow-hidden rounded-2xl border bg-muted/40 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    zoom > 1 && "cursor-grab active:cursor-grabbing",
                  )}
                >
                  {previewImage(item)}
                  <div className="pointer-events-none absolute inset-0">{previewStatus(item)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Slider mode setup actions */}
        {activeMode === "slider" && canSlide && items.some((item) => canUsePictureSetup(item.harness?.provenance)) && onUseSetup && (
          <div className="grid grid-cols-2 gap-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-2xl border bg-muted/30 px-3 py-2">
                <span className="truncate text-xs font-medium" title={itemTitle(item)}>{itemTitle(item)}</span>
                {canUsePictureSetup(item.harness?.provenance) ? (
                  <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => { onUseSetup(item); onClose(); }}>
                    <SparklesIcon data-icon="inline-start" />Use this setup
                  </Button>
                ) : <span className="text-xs text-muted-foreground">No setup saved</span>}
              </div>
            ))}
          </div>
        )}

        {/* Comparison details table */}
        <section aria-label="Generation comparison" className="flex flex-col gap-2">
          {!hasAnyProvenance && <p className="text-xs text-muted-foreground">None of these pictures have generation details saved.</p>}
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th scope="col" className="w-32 px-3 py-2 font-medium">Setting</th>
                  {items.map((item) => (
                    <th key={item.id} scope="col" className="min-w-36 px-3 py-2 font-medium">
                      <span className="block max-w-48 truncate" title={itemTitle(item)}>{itemTitle(item)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    data-diff={row.differs ? "true" : undefined}
                    className={cn(row.differs ? "bg-muted/60 text-foreground" : "text-muted-foreground")}
                  >
                    <th scope="row" className="px-3 py-2 align-top font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{row.label}</span>
                        {row.differs && <Badge variant="secondary">Differs</Badge>}
                      </span>
                    </th>
                    {row.values.map((value, index) => (
                      <td key={items[index].id} className={cn("max-w-xs px-3 py-2 align-top break-words whitespace-pre-wrap tabular-nums", row.differs && "font-medium text-foreground")}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
