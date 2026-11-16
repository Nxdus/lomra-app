"use client";

import { ConfirmDelete } from "@/components/confirm-delete";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { ArrowDownToLineIcon, ArrowUpToLineIcon, CopyIcon, DownloadIcon, GripVerticalIcon, InfoIcon, PencilIcon, PlusIcon, ScanIcon, Trash2Icon } from "lucide-react";
import { CanvasMedia } from "@/components/canvas-media";
import dynamic from "next/dynamic";
import { PictureEditor, type PictureEditorHandle } from "@/components/picture-editor";
import { CanvasMenu } from "@/components/canvas-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { canvasHistory, canvasTitle, canvasStorage, isCanvasFilePending, deleteCanvasStorage, canvasFileError, canvasFileKind, canvasFileSize, type CanvasImage, type CanvasHistoryItem } from "@/lib/image-canvas/image-canvas-storage";
import { CANVAS_CAMERA_KEY, canvasPoint, parseCanvasCamera, zoomCamera, type CanvasCamera } from "@/lib/image-canvas/image-canvas-camera";
import { resizeImage, type ImageBounds, type ImageCorner } from "@/lib/image-canvas/image-canvas-resize";
import { reorganizeCanvas, fitCanvas } from "@/lib/image-canvas/image-canvas-layout";
import { getSetting, saveSetting } from "@/lib/settings";
import { canvasMediaVisible } from "@/lib/image-canvas/image-canvas-visibility";
import {
  areCanvasItemsEqual,
  cloneCanvasItems,
  collectReferencedUrls,
  emptyCanvasHistory,
  isNativeTextEditingTarget,
  isRedoKeyboardShortcut,
  isUndoKeyboardShortcut,
  pushCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
  type CanvasHistoryEntry,
  type CanvasHistoryState,
} from "@/lib/image-canvas/image-canvas-history";

export type VisibleImage = CanvasImage & { url: string };
const ModelInspector = dynamic(() => import("@/components/model-inspector").then(module => module.ModelInspector), { ssr: false });

function createNewCanvasId() {
  return `canvas-${Date.now()}-${crypto.randomUUID()}`;
}

function ImageResizeHandles({ name, onPointerDown, onKeyDown }: {
  name: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, corner: ImageCorner) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, corner: ImageCorner) => void;
}) {
  return ([
    ["top-left", "-top-1 -left-1 rounded-tl-2xl border-t-2 border-l-2 cursor-nwse-resize"],
    ["top-right", "-top-1 -right-1 rounded-tr-2xl border-t-2 border-r-2 cursor-nesw-resize"],
    ["bottom-left", "-bottom-1 -left-1 rounded-bl-2xl border-b-2 border-l-2 cursor-nesw-resize"],
    ["bottom-right", "-bottom-1 -right-1 rounded-br-2xl border-b-2 border-r-2 cursor-nwse-resize"],
  ] as const).map(([corner, className]) => (
    <Button
      key={corner}
      variant="ghost"
      size="icon-xs"
      className={cn("absolute size-5 rounded-none border-0 border-ring p-0 transition-none hover:bg-transparent! active:translate-y-0", className)}
      aria-label={`Resize ${name} from ${corner}`}
      title="Drag to resize · Arrow keys to resize"
      onPointerDown={(event) => onPointerDown(event, corner)}
      onKeyDown={(event) => onKeyDown(event, corner)}
    />
  ));
}

export type CanvasHandle = { addFiles: (files: File[]) => Promise<void>; focusFile: (file: File) => void; modelPreview: (id: string) => string };

export function ImageCanvas({ ref, onSelectionChange, onReadyChange, onCanvasChange }: { ref?: Ref<CanvasHandle>; onSelectionChange?: (images: VisibleImage[]) => void; onReadyChange?: (ready: boolean) => void; onCanvasChange?: (id: string) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = useRef<VisibleImage[]>([]);
  const urls = useRef(new Set<string>());
  const mounted = useRef(false);
  const storageAvailable = useRef(true);
  const saves = useRef(Promise.resolve());
  const imports = useRef(Promise.resolve());
  const drag = useRef<{ ids: string[]; pointer: number; x: number; y: number } | null>(null);
  const resize = useRef<{ id: string; pointer: number; corner: ImageCorner; x: number; y: number; image: ImageBounds } | null>(null);
  const dragSnapshot = useRef<VisibleImage[] | null>(null);
  const resizeSnapshot = useRef<VisibleImage[] | null>(null);
  const canvasHistories = useRef<Map<string, CanvasHistoryState>>(new Map());
  const dragDepth = useRef(0);
  const view = useRef<CanvasCamera>({ x: 0, y: 0, scale: 1 });
  const pan = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const selection = useRef<{ pointer: number; x: number; y: number; initial: string[] } | null>(null);
  const [selectionBox, setSelectionBox] = useState<ImageBounds | null>(null);
  const [camera, setCamera] = useState<CanvasCamera>({ x: 0, y: 0, scale: 1 });
  const [panning, setPanning] = useState(false);
  const [images, setImages] = useState<VisibleImage[]>([]);
  const [layoutUndo, setLayoutUndo] = useState<{ bounds: Map<string, ImageBounds>; camera: CanvasCamera } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const inspected = images.find(image => image.id === inspectId);
  const pictureEditor = useRef<PictureEditorHandle>(null);
  const preview = images.find((image) => image.id === previewId);
  const [ready, setReady] = useState(false);
  const [canvasId, setCanvasId] = useState('default');
  const activeCanvas = useRef('default');
  const switching = useRef(false);
  const [history, setHistory] = useState<CanvasHistoryItem[]>([]);
  const cameraKey = () => activeCanvas.current === 'default' ? 'camera' : `camera-${activeCanvas.current}`;
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => { onReadyChange?.(ready); }, [ready, onReadyChange]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deletingFiles, setDeletingFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeMedia, setActiveMedia] = useState<Set<string>>(new Set());
  const activeMediaRef = useRef(activeMedia);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const contextMenuFiles = images.filter((image) => selected.includes(contextMenuId ?? "") ? selected.includes(image.id) : image.id === contextMenuId);
  const [dragOver, setDragOver] = useState(false);
  const cameraLoaded = useRef(false);
  const zoomTarget = useRef<CanvasCamera | null>(null);
  const zoomFrame = useRef<number | null>(null);
  const cameraSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cameraSaves = useRef(Promise.resolve());

  useEffect(() => {
    const element = viewport.current!;
    const updateVisibility = () => {
      const previous = activeMediaRef.current;
      const next = new Set(images.filter(image =>
        selected.includes(image.id) || canvasMediaVisible(image, camera, { width: element.clientWidth, height: element.clientHeight }, previous.has(image.id))
      ).map(image => image.id));
      if (next.size === previous.size && [...next].every(id => previous.has(id))) return;
      activeMediaRef.current = next;
      setActiveMedia(next);
    };
    updateVisibility();
    const observer = new ResizeObserver(updateVisibility);
    observer.observe(element);
    return () => observer.disconnect();
  }, [images, camera, selected]);

  useEffect(() => {
    onSelectionChange?.(images.filter((image) => image.url && selected.includes(image.id)));
  }, [images, selected, onSelectionChange]);

  const mediaLoaded = useCallback((id: string, file: File) => {
    const image = current.current.find(item => item.id === id);
    if (!image || image.url) return;
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    current.current = current.current.map(item => item.id === id ? { ...item, file, url } : item);
    setImages(current.current);
  }, []);

  const changeView = useCallback((next: CanvasCamera) => {
    if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = null;
    zoomTarget.current = null;
    view.current = next;
    setCamera(next);
    if (!cameraLoaded.current) return;
    clearTimeout(cameraSave.current);
    const key = cameraKey();
    cameraSave.current = setTimeout(() => {
      cameraSaves.current = cameraSaves.current.then(() => saveSetting(key, next))
        .then(() => { toast.close("canvas-view-error"); })
        .catch(() => { toast.add({ id: "canvas-view-error", title: "Could not save canvas view. Reload to retry.", type: "error" }); });
    }, 400);
  }, []);

  const smoothZoom = useCallback((scale: number, x: number, y: number) => {
    const target = zoomCamera(zoomTarget.current ?? view.current, scale, x, y);
    zoomTarget.current = target;
    if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    clearTimeout(cameraSave.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      changeView(target);
      return;
    }
    let lastTime = performance.now();
    function frame(time: number) {
      const amount = 1 - Math.exp(-(time - lastTime) / 45);
      lastTime = time;
      const previous = view.current;
      const next = {
        x: previous.x + (target.x - previous.x) * amount,
        y: previous.y + (target.y - previous.y) * amount,
        scale: previous.scale + (target.scale - previous.scale) * amount,
      };
      if (Math.abs(next.scale - target.scale) < 0.0001 && Math.hypot(next.x - target.x, next.y - target.y) < 0.1) {
        changeView(target);
        return;
      }
      view.current = next;
      setCamera(next);
      zoomFrame.current = requestAnimationFrame(frame);
    }
    zoomFrame.current = requestAnimationFrame(frame);
  }, [changeView]);

  useEffect(() => () => {
    if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    Promise.all([canvasStorage(undefined, activeCanvas.current, true), getSetting<CanvasCamera>(cameraKey(), activeCanvas.current === 'default' ? CANVAS_CAMERA_KEY : undefined)]).then(([stored, savedCamera]) => {
      if (cancelled) return;
      current.current = stored.map((image) => {
        const url = isCanvasFilePending(image.file) ? "" : URL.createObjectURL(image.file);
        if (url) urls.current.add(url);
        return { ...image, url };
      });
      setImages(current.current);
      const saved = parseCanvasCamera(JSON.stringify(savedCamera) ?? null);
      view.current = saved;
      setCamera(saved);
      cameraLoaded.current = true;
      storageAvailable.current = true;
      toast.close("canvas-save-error");
    }).catch((error: unknown) => {
      if (cancelled) return;
      // Do not overwrite a saved canvas that could not be read.
      storageAvailable.current = false;
      toast.add({
        id: "canvas-save-error", title: "Could not load saved canvas. Changes will not be saved until loading succeeds.",
        description: error instanceof Error ? error.message : "Please retry.", type: "error",
        actionProps: { children: "Retry", onClick: () => { setReady(false); cameraLoaded.current = false; setLoadAttempt((attempt) => attempt + 1); } },
      });
    }).finally(() => {
      if (cancelled) return;
      setReady(true);
    });
    const activeUrls = urls.current;
    return () => {
      cancelled = true;
      mounted.current = false;
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, [loadAttempt]);

  useEffect(() => {
    const element = viewport.current!;
    function wheel(event: WheelEvent) {
      if (event.composedPath().some((target) => target instanceof HTMLElement && target.hasAttribute("data-canvas-interactive"))) return;
      event.preventDefault();
      if (!cameraLoaded.current || pan.current || drag.current || resize.current || selection.current) return;
      const rect = element.getBoundingClientRect();
      const deltaUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const previous = view.current;
      if (event.ctrlKey || event.metaKey) {
        smoothZoom((zoomTarget.current ?? previous).scale * Math.exp(-event.deltaY * deltaUnit * 0.002), event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      changeView({ ...previous, x: previous.x - event.deltaX * deltaUnit, y: previous.y - event.deltaY * deltaUnit });
    }
    function blur() {
      pan.current = null;
      selection.current = null;
      setSelectionBox(null);
      setPanning(false);
    }
    // React wheel handlers are passive, so use a native listener to prevent browser zoom.
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
    };
  }, [changeView, smoothZoom]);

  function zoom(factor: number) {
    const element = viewport.current!;
    smoothZoom((zoomTarget.current ?? view.current).scale * factor, element.clientWidth / 2, element.clientHeight / 2);
  }

  function finishPan() {
    pan.current = null;
    selection.current = null;
    setSelectionBox(null);
    setPanning(false);
  }

  function persist(next: VisibleImage[]) {
    if (!storageAvailable.current) return;
    const snapshot = next.map(({ id, file, x, y, width, height }) => ({ id, file, x, y, width, height }));
    const id = activeCanvas.current;
    saves.current = saves.current.then(async () => {
      try {
        await canvasStorage(snapshot, id);
        if (mounted.current) toast.close("canvas-save-error");
      } catch {
        if (mounted.current) toast.add({ id: "canvas-save-error", title: "Latest changes could not be saved. Keep this page open; storage may be full or unavailable.", type: "error" });
      }
    });
  }

  async function openCanvas(id?: string) {
    if (!ready || switching.current || !storageAvailable.current) return;
    switching.current = true;
    setReady(false);
    try {
      await imports.current;
      await saves.current;
      await canvasStorage(current.current.map(({ id, file, x, y, width, height }) => ({ id, file, x, y, width, height })), activeCanvas.current);
      clearTimeout(cameraSave.current);
      await cameraSaves.current;
      await saveSetting(cameraKey(), view.current);
      const nextId = id ?? createNewCanvasId();
      if (!id) await canvasStorage([], nextId);
      else await canvasStorage(undefined, nextId, true);
      activeCanvas.current = nextId;
      setLayoutUndo(null);
      setCanvasId(nextId);
      onCanvasChange?.(nextId);
      setSelected([]);
      finishPan();
      drag.current = null;
      resize.current = null;
      dragSnapshot.current = null;
      resizeSnapshot.current = null;
      cameraLoaded.current = false;
      setLoadAttempt((attempt) => attempt + 1);
    } catch (error) {
      toast.add({ title: 'Could not switch canvas', description: error instanceof Error ? error.message : 'Please retry.', type: 'error' });
      setReady(true);
    } finally {
      switching.current = false;
    }
  }

  async function refreshHistory() {
    try { setHistory(await canvasHistory()); }
    catch { toast.add({ title: 'Could not load canvas history. Please retry.', type: 'error' }); }
  }

  async function deleteCanvas(id: string) {
    if (!ready || switching.current || !storageAvailable.current) return;
    // Switch first so queued saves and imports cannot recreate the deleted canvas.
    if (id === activeCanvas.current) {
      await openCanvas();
      if (id === activeCanvas.current) throw new Error('Could not switch away from the canvas');
    }
    try {
      await deleteCanvasStorage(id);
      canvasHistories.current.delete(id);
      cleanupUnreferencedUrls();
      await refreshHistory();
    } catch (error) {
      toast.add({ title: 'Could not delete canvas', description: error instanceof Error ? error.message : 'Please retry.', type: 'error' });
      throw error;
    }
  }

  function ensureRestoredUrl(item: VisibleImage): VisibleImage {
    if (item.url && urls.current.has(item.url)) return item;
    if (!isCanvasFilePending(item.file)) {
      const url = URL.createObjectURL(item.file);
      urls.current.add(url);
      return { ...item, url };
    }
    return item;
  }

  function cleanupUnreferencedUrls() {
    const referenced = collectReferencedUrls(current.current, canvasHistories.current.values());
    for (const url of Array.from(urls.current)) {
      if (!referenced.has(url)) {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }
    }
  }

  function recordCanvasHistory(entry: CanvasHistoryEntry) {
    const canvasId = activeCanvas.current;
    const currentHist = canvasHistories.current.get(canvasId) ?? emptyCanvasHistory;
    const nextHist = pushCanvasHistory(currentHist, entry, current.current);
    canvasHistories.current.set(canvasId, nextHist);
    cleanupUnreferencedUrls();
  }

  function update(next: VisibleImage[], save = true) {
    current.current = next;
    setImages(next);
    if (save) persist(next);
  }

  function undo() {
    if (!ready) return;
    const canvasId = activeCanvas.current;
    const currentHist = canvasHistories.current.get(canvasId) ?? emptyCanvasHistory;
    const result = undoCanvasHistory(currentHist, current.current, view.current);
    if (!result) return;
    canvasHistories.current.set(canvasId, result.state);
    const restored = result.items.map(ensureRestoredUrl);
    update(restored, true);
    if (result.camera) {
      changeView(result.camera);
    }
    setLayoutUndo(null);
    cleanupUnreferencedUrls();
    const restoredIds = restored.map(item => item.id);
    const validSelected = selected.filter(id => restoredIds.includes(id));
    setSelected(validSelected.length ? validSelected : (restoredIds.length ? [restoredIds[restoredIds.length - 1]] : []));
  }

  function redo() {
    if (!ready) return;
    const canvasId = activeCanvas.current;
    const currentHist = canvasHistories.current.get(canvasId) ?? emptyCanvasHistory;
    const result = redoCanvasHistory(currentHist, current.current, view.current);
    if (!result) return;
    canvasHistories.current.set(canvasId, result.state);
    const restored = result.items.map(ensureRestoredUrl);
    update(restored, true);
    if (result.camera) {
      changeView(result.camera);
    }
    setLayoutUndo(null);
    cleanupUnreferencedUrls();
    const restoredIds = restored.map(item => item.id);
    const validSelected = selected.filter(id => restoredIds.includes(id));
    setSelected(validSelected.length ? validSelected : (restoredIds.length ? [restoredIds[restoredIds.length - 1]] : []));
  }

  function select(id: string, additive = false) {
    setSelected((previous) => additive ? previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id] : [id]);
  }

  function reorganize() {
    const element = viewport.current;
    if (!ready || !element || !current.current.length) return;
    const previous = current.current;
    const previousCamera = { ...view.current };
    setLayoutUndo({ bounds: new Map(previous.map(({ id, x, y, width, height }) => [id, { x, y, width, height }])), camera: previousCamera });
    const next = reorganizeCanvas(previous, element.clientWidth);
    const nextCamera = fitCanvas(next, element.clientWidth, element.clientHeight);
    if (!areCanvasItemsEqual(previous, next)) {
      recordCanvasHistory({
        items: previous,
        camera: previousCamera,
        nextCamera,
        type: 'reorganize',
      });
    }
    update(next);
    changeView(nextCamera);
    element.focus({ preventScroll: true });
  }

  function undoReorganize() {
    if (!ready || !layoutUndo) return;
    undo();
  }

  function duplicateSelection() {
    const previous = current.current;
    const copies = contextMenuFiles.map((image) => {
      const url = URL.createObjectURL(image.file);
      urls.current.add(url);
      return { ...image, id: crypto.randomUUID(), url, x: image.x + 24, y: image.y + 24 };
    });
    recordCanvasHistory({ items: previous, type: 'generic' });
    update([...previous, ...copies]);
    setSelected(copies.map((image) => image.id));
  }

  function reorderSelection(front: boolean) {
    const ids = new Set(contextMenuFiles.map((image) => image.id));
    const chosen = current.current.filter((image) => ids.has(image.id));
    const rest = current.current.filter((image) => !ids.has(image.id));
    const previous = current.current;
    const next = front ? [...rest, ...chosen] : [...chosen, ...rest];
    if (!areCanvasItemsEqual(previous, next)) {
      recordCanvasHistory({ items: previous, type: 'generic' });
      update(next);
    }
  }

  function remove(ids: string[]) {
    const removed = current.current.filter((item) => ids.includes(item.id));
    if (!removed.length) return;
    const previous = current.current;
    const next = previous.filter((item) => !ids.includes(item.id));
    recordCanvasHistory({ items: previous, type: 'delete' });
    update(next);
    cleanupUnreferencedUrls();
    setSelected((previous) => previous.filter((id) => !ids.includes(id)));
    viewport.current?.focus({ preventScroll: true });
  }

  function point(clientX: number, clientY: number) {
    const element = viewport.current!;
    const rect = element.getBoundingClientRect();
    return canvasPoint(view.current, clientX - rect.left, clientY - rect.top);
  }

  function importFiles(files: File[], origin: { x: number; y: number }, centered = false) {
    if (!ready) return;
    imports.current = imports.current.then(async () => {
      const failures: string[] = [];
      let offset = 0;
      for (const file of files) {
        if (!mounted.current) return;
        const error = canvasFileError(file);
        if (error) { failures.push(`${file.name}: ${error}`); continue; }
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        try {
          const size = await canvasFileSize(file, url);
          if (!mounted.current) { URL.revokeObjectURL(url); urls.current.delete(url); return; }
          const image = {
            id: crypto.randomUUID(), file, url, ...size,
            x: origin.x + offset - (centered ? size.width / 2 : 0),
            y: origin.y + offset - (centered ? size.height / 2 : 0),
          };
          recordCanvasHistory({ items: current.current, type: "generic" });
          update([...current.current, image]);
          setSelected([image.id]);
          offset += 24;
        } catch {
          URL.revokeObjectURL(url);
          urls.current.delete(url);
          failures.push(`${file.name}: Could not open this file. Check its format and browser support.`);
        }
      }
      if (mounted.current && failures.length) toast.add({ title: "Could not import files", description: failures.join("\n"), type: "error" });
    });
  }

  function finishDrag() {
    if (!drag.current && !resize.current) return;
    const previous = dragSnapshot.current ?? resizeSnapshot.current;
    const actionType = dragSnapshot.current ? "move" : "resize";
    drag.current = null;
    resize.current = null;
    dragSnapshot.current = null;
    resizeSnapshot.current = null;
    if (previous && !areCanvasItemsEqual(previous, current.current)) {
      recordCanvasHistory({ items: previous, type: actionType });
      persist(current.current);
    }
  }

  useImperativeHandle(ref, () => ({ modelPreview(id) {
    const item = Array.from(viewport.current?.querySelectorAll<HTMLElement>("[data-canvas-image]") ?? []).find((element) => element.dataset.canvasImage === id);
    const viewer = item?.querySelector("model-viewer") as (HTMLElement & { loaded: boolean; toDataURL: (type: string) => string }) | null;
    if (!viewer?.loaded) throw new Error("Wait for the selected 3D model to finish loading, then try again.");
    return viewer.toDataURL("image/png");
  }, focusFile(file) {
    const image = current.current.find((item) => item.file === file);
    const element = viewport.current;
    if (!image || !element) throw new Error("This item is no longer on the canvas. Add it again.");
    select(image.id);
    const scale = Math.min(1, element.clientWidth * 0.8 / image.width, element.clientHeight * 0.6 / image.height);
    changeView({ scale, x: element.clientWidth / 2 - (image.x + image.width / 2) * scale, y: element.clientHeight * 0.35 - (image.y + image.height / 2) * scale });
    element.focus({ preventScroll: true });
  }, async addFiles(files) {
    const element = viewport.current;
    if (!ready || !element) throw new Error("Canvas is still loading. Try again.");
    importFiles(files, canvasPoint(view.current, element.clientWidth / 2, element.clientHeight / 2), true);
    await imports.current;
    if (files.some((file) => !current.current.some((image) => image.file === file))) throw new Error("Could not add this result to canvas. Check its format and try again.");
  } }));

  function startResize(event: PointerEvent<HTMLButtonElement>, image: VisibleImage, corner: ImageCorner) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    viewport.current?.focus({ preventScroll: true });
    const position = point(event.clientX, event.clientY);
    resizeSnapshot.current = cloneCanvasItems(current.current);
    resize.current = { id: image.id, pointer: event.pointerId, corner, ...position, image };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, id: string, corner: ImageCorner) {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 40 : 10;
    const previous = current.current;
    const next = previous.map((item) => item.id === id ? {
      ...item, ...resizeImage(item, corner, direction[0] * step, direction[1] * step),
    } : item);
    if (!areCanvasItemsEqual(previous, next)) {
      recordCanvasHistory({ items: previous, type: "resize" });
      update(next);
    }
  }

  return (
    <>
      <ContextMenu open={contextMenuId === "background"} onOpenChange={(open) => setContextMenuId((id) => open ? "background" : id === "background" ? null : id)}>
      <ContextMenuTrigger
        render={<div />}
        ref={viewport}
        role="region"
        aria-label="Media canvas"
        aria-busy={!ready}
        tabIndex={0}
        className={cn("absolute inset-0 touch-none overflow-hidden bg-background bg-[radial-gradient(var(--border)_1px,transparent_1px)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", dragOver && "ring-2 ring-inset ring-primary", panning && "cursor-grabbing")}
        style={{ backgroundSize: `${24 * camera.scale}px ${24 * camera.scale}px`, backgroundPosition: `${camera.x + 12 * camera.scale}px ${camera.y + 12 * camera.scale}px` }}
        onPointerDownCapture={(event) => {
          if ((event.target as HTMLElement).closest("[data-canvas-interactive]")) return;
          if (event.button === 0) setContextMenuId(null);
          if (zoomTarget.current) changeView(view.current);
          if (!ready || !event.isPrimary || pan.current || selection.current) return;
          const onImage = (event.target as HTMLElement).closest("[data-canvas-image]");
          if (event.button !== 1 && !(event.button === 0 && !onImage && !(event.target as HTMLElement).closest("button"))) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          if (event.button === 1) {
            pan.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
            setPanning(true);
          } else {
            const origin = point(event.clientX, event.clientY);
            const initial = event.shiftKey ? selected : [];
            selection.current = { pointer: event.pointerId, ...origin, initial };
            setSelected(initial);
            setSelectionBox({ ...origin, width: 0, height: 0 });
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const selecting = selection.current;
          if (selecting?.pointer === event.pointerId) {
            const position = point(event.clientX, event.clientY);
            const box = { x: Math.min(selecting.x, position.x), y: Math.min(selecting.y, position.y), width: Math.abs(position.x - selecting.x), height: Math.abs(position.y - selecting.y) };
            setSelectionBox(box);
            const hits = current.current.filter((image) => box.width > 0 && box.height > 0 && image.x < box.x + box.width && image.x + image.width > box.x && image.y < box.y + box.height && image.y + image.height > box.y);
            setSelected([...new Set([...selecting.initial, ...hits.map((image) => image.id)])]);
            return;
          }
          const active = pan.current;
          if (!active || active.pointer !== event.pointerId) return;
          changeView({ ...view.current, x: view.current.x + event.clientX - active.x, y: view.current.y + event.clientY - active.y });
          active.x = event.clientX;
          active.y = event.clientY;
        }}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onLostPointerCapture={finishPan}
        onPaste={(event) => {
          if (!ready || event.target !== viewport.current) return;
          const files = Array.from(event.clipboardData.files);
          if (!files.length) return;
          event.preventDefault();
          const element = event.currentTarget;
          importFiles(files, canvasPoint(view.current, element.clientWidth / 2, element.clientHeight / 2), true);
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = ready ? "copy" : "none";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          if (!ready) return;
          event.currentTarget.focus({ preventScroll: true });
          importFiles(Array.from(event.dataTransfer.files), point(event.clientX, event.clientY));
        }}
        onKeyDown={(event) => {
          if (!ready) return;
          const target = event.target as HTMLElement | null;
          if (!target || isNativeTextEditingTarget(target)) return;
          if (target !== viewport.current && !viewport.current?.contains(target)) return;

          if (isUndoKeyboardShortcut(event)) {
            event.preventDefault();
            if (layoutUndo && (canvasHistories.current.get(activeCanvas.current)?.past.length ?? 0) === 0) {
              undoReorganize();
            } else {
              undo();
            }
            return;
          }
          if (isRedoKeyboardShortcut(event)) {
            event.preventDefault();
            redo();
            return;
          }
          if (!selected.length) return;
          if (event.key === "Enter" && selected.length === 1 && images.some((image) => image.url && image.id === selected[0] && canvasFileKind(image.file) === "image")) {
            event.preventDefault();
            setPreviewId(selected[0]);
            return;
          }
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            if (!event.repeat) setDeletingFiles([...selected]);
            return;
          }
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!direction) return;
          event.preventDefault();
          const step = event.shiftKey ? 40 : 10;
          const previous = current.current;
          const next = previous.map((image) => selected.includes(image.id) ? {
            ...image, x: image.x + direction[0] * step, y: image.y + direction[1] * step,
          } : image);
          if (!areCanvasItemsEqual(previous, next)) {
            recordCanvasHistory({ items: previous, type: "move" });
            update(next);
          }
        }}
      >
        <div
          className="absolute inset-0 isolate origin-top-left"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          {images.map((image) => (
            <ContextMenu key={`${canvasId}:${image.id}`} open={contextMenuId === image.id} onOpenChange={(open) => setContextMenuId((id) => open ? image.id : id === image.id ? null : id)}>
            <ContextMenuTrigger
              render={<div />}
              data-canvas-image={image.id}
              onContextMenu={(event) => { event.stopPropagation(); if (!selected.includes(image.id)) select(image.id); }}
              onDoubleClick={(event) => {
                if (!image.url || canvasFileKind(image.file) !== "image" || (event.target as HTMLElement).closest("button")) return;
                event.stopPropagation();
                setPreviewId(image.id);
              }}
              className={cn("absolute touch-none cursor-grab select-none active:cursor-grabbing", panning && "cursor-grabbing")}
              style={{ left: image.x, top: image.y, width: image.width, height: image.height }}
              onPointerDownCapture={(event) => {
                if (event.button === 0 && (event.target as HTMLElement).closest("[data-canvas-interactive]")) select(image.id, event.shiftKey);
              }}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("[data-canvas-interactive]") || ((event.target as HTMLElement).closest("button") && !(event.target as HTMLElement).closest("[data-canvas-drag-handle]"))) return;
                event.preventDefault();
                viewport.current?.focus({ preventScroll: true });
                if (event.shiftKey) { select(image.id, true); return; }
                const ids = selected.includes(image.id) ? selected : [image.id];
                if (!selected.includes(image.id)) select(image.id);
                const position = point(event.clientX, event.clientY);
                dragSnapshot.current = cloneCanvasItems(current.current);
                drag.current = { ids, pointer: event.pointerId, x: position.x, y: position.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const resizing = resize.current;
                if (resizing?.pointer === event.pointerId) {
                  const position = point(event.clientX, event.clientY);
                  const bounds = resizeImage(resizing.image, resizing.corner, position.x - resizing.x, position.y - resizing.y);
                  update(current.current.map((item) => item.id === resizing.id ? { ...item, ...bounds } : item), false);
                  return;
                }
                const active = drag.current;
                if (!active || active.pointer !== event.pointerId) return;
                const position = point(event.clientX, event.clientY);
                update(current.current.map((item) => active.ids.includes(item.id) ? {
                  ...item, x: item.x + position.x - active.x, y: item.y + position.y - active.y,
                } : item), false);
                active.x = position.x;
                active.y = position.y;
              }}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
            >
              {canvasFileKind(image.file) === "image" ? (activeMedia.has(image.id) && <CanvasMedia key={image.url} image={image} onLoaded={mediaLoaded} />) : <div className="flex size-full flex-col overflow-hidden rounded-xl border bg-card">
                <Button variant="secondary" size="sm" data-canvas-drag-handle className="h-7 w-full shrink-0 justify-start rounded-none border-0 pr-10 active:translate-y-0" aria-label={`Move ${image.file.name}`}>
                  <GripVerticalIcon /><span className="truncate">{image.file.name}</span>
                </Button>
                <div className="min-h-0 flex-1" data-canvas-interactive>
                  {activeMedia.has(image.id) && <CanvasMedia key={image.url} image={image} onLoaded={mediaLoaded} />}
                </div>
              </div>}
              {selected.includes(image.id) && (
                <ImageResizeHandles
                  name={image.file.name || "image"}
                  onPointerDown={(event, corner) => startResize(event, image, corner)}
                  onKeyDown={(event, corner) => resizeWithKeyboard(event, image.id, corner)}
                />
              )}
            </ContextMenuTrigger>
            <ContextMenuContent data-canvas-interactive>
              <ContextMenuGroup>
                {contextMenuFiles.length === 1 && contextMenuFiles[0].url && canvasFileKind(contextMenuFiles[0].file) === "3d" && (
                  <ContextMenuItem onClick={() => setInspectId(contextMenuFiles[0].id)}>
                    <ScanIcon /> Inspect model
                  </ContextMenuItem>
                )}
                {contextMenuFiles.length === 1 && contextMenuFiles[0].url && canvasFileKind(contextMenuFiles[0].file) === "image" && (
                  <ContextMenuItem onClick={() => setPreviewId(contextMenuFiles[0].id)}>
                    <PencilIcon /> Open / Edit
                  </ContextMenuItem>
                )}
                <ContextMenuItem disabled={contextMenuFiles.some(image => !image.url)} onClick={duplicateSelection}>
                  <CopyIcon /> Duplicate{contextMenuFiles.length > 1 && ` (${contextMenuFiles.length})`}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => reorderSelection(true)}>
                  <ArrowUpToLineIcon /> Bring to front
                </ContextMenuItem>
                <ContextMenuItem onClick={() => reorderSelection(false)}>
                  <ArrowDownToLineIcon /> Send to back
                </ContextMenuItem>
                <ContextMenuItem disabled={contextMenuFiles.some(image => !image.url)} onClick={() => {
                  for (const file of contextMenuFiles) {
                    const link = document.createElement("a");
                    link.href = file.url;
                    link.download = file.file.name;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  }
                }}>
                  <DownloadIcon /> Download{contextMenuFiles.length > 1 && ` (${contextMenuFiles.length})`}
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => setDeletingFiles(contextMenuFiles.map((file) => file.id))}>
                  <Trash2Icon /> Delete{contextMenuFiles.length > 1 && ` (${contextMenuFiles.length})`}
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
            </ContextMenu>
          ))}
          {selectionBox && <div aria-hidden="true" className="pointer-events-none absolute z-10 border border-primary bg-primary/10" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-canvas-interactive>
        <ContextMenuGroup>
          <ContextMenuItem disabled={!ready || !images.length} onClick={() => setSelected(images.map((image) => image.id))}>
            <ScanIcon /> Select all
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
      </ContextMenu>
      <Dialog open={!!inspected} onOpenChange={open => { if (!open) setInspectId(null); }}>
        <DialogContent className="max-h-[90dvh] gap-3 overflow-y-auto sm:max-w-5xl" aria-describedby={undefined}>
          <DialogTitle className="truncate pr-10"><span className="sr-only">Inspect model · </span>{inspected?.file.name}</DialogTitle>
          {inspected && <ModelInspector key={inspected.id} src={inspected.url} file={inspected.file} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open && (pictureEditor.current?.requestClose() ?? true)) setPreviewId(null); }}>
        <DialogContent className="w-fit max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-4rem)]" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{preview?.file.name || "Image preview"}</DialogTitle>
          {preview && <PictureEditor ref={pictureEditor} key={preview.id} url={preview.url} name={preview.file.name} onClose={() => setPreviewId(null)} onSave={async (file) => {
            importFiles([file], { x: preview.x + preview.width + 24, y: preview.y });
            await imports.current;
            if (!current.current.some((image) => image.file === file)) throw new Error("Could not add edited picture to canvas.");
            toast.add({ title: "Edited picture saved to canvas", type: "success" });
          }} />}
        </DialogContent>
      </Dialog>
      <ConfirmDelete open={deletingFiles.length > 0} onOpenChange={(open) => { if (!open) setDeletingFiles([]); }} title="Delete canvas files?" description={`${deletingFiles.length} selected file(s) will be removed from this canvas.`} disabled={!ready} onConfirm={() => remove(deletingFiles)} />
      <CanvasMenu canvasId={canvasId} history={history} onHistory={refreshHistory} onNew={() => void openCanvas()} onOpen={(id) => void openCanvas(id)} onDelete={deleteCanvas} title={canvasTitle(canvasId)} scale={camera.scale} ready={ready} onZoom={zoom} onReset={() => changeView({ x: 0, y: 0, scale: 1 })} canReorganize={images.length > 0} onReorganize={reorganize} />
      <div className="absolute left-4 top-4 flex items-center gap-2 text-muted-foreground">
        <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.glb" className="hidden" aria-label="Add canvas files" onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          const element = viewport.current!;
          importFiles(files, canvasPoint(view.current, element.clientWidth / 2, element.clientHeight / 2), true);
        }} />
        <Button variant="ghost" size="icon-sm" aria-label="Add images, videos or 3D models" disabled={!ready} onClick={() => fileInput.current?.click()}><PlusIcon /></Button>
        <TooltipProvider>
          <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Canvas help" />}
              closeOnClick={false}
              onClick={() => setHelpOpen(true)}
            >
              <InfoIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" sideOffset={10} className="canvas-help">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <p>Add, drop or paste images, MP4/WebM videos or GLB models.</p>
                  <p>Move videos and models by their title bar. Drag corners to resize.</p>
                  <p>Drag inside a 3D model to rotate; scroll to zoom.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2.5">
                    <dt>Select multiple</dt><dd className="text-right"><Kbd>Shift</Kbd> + click</dd>
                    <dt className="col-span-2 opacity-65">Left-drag the background to select; hold <Kbd>Shift</Kbd> to add.</dt>
                    <dt>Pan canvas</dt><dd className="text-right">Two-finger scroll<br />or middle-drag</dd>
                    <dt>Zoom canvas</dt><dd className="text-right"><Kbd>Ctrl</Kbd> / <Kbd aria-label="Command">⌘</Kbd> + scroll</dd>
                    <dt>Nudge selection</dt><dd className="text-right"><KbdGroup aria-label="Arrow keys"><Kbd aria-label="Up arrow">↑</Kbd><Kbd aria-label="Down arrow">↓</Kbd><Kbd aria-label="Left arrow">←</Kbd><Kbd aria-label="Right arrow">→</Kbd></KbdGroup></dd>
                    <dt>Remove selection</dt><dd className="text-right"><Kbd>Delete</Kbd></dd>
                  </dl>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
}
