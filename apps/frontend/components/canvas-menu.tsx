"use client";

import { Tip } from "@/components/tip";
import { useEffect, useRef, useState } from "react";
import { DownloadIcon, EllipsisIcon, HistoryIcon, FilePlusIcon, LayoutGridIcon, MenuIcon, MinusIcon, PlusIcon, SearchIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { swipeDeleteThreshold, useSwipeToDelete } from "@/hooks/use-swipe-to-delete";
import { canvasTitle, renameCanvas, type CanvasHistoryItem } from "@/lib/image-canvas/image-canvas-storage";
import { exportProject, importProject } from "@/lib/storage";
import { cn } from "@/lib/utils";

export function CanvasMenu({ canvasId, history, onHistory, onNew, onOpen, onDelete, title, scale, ready, onZoom, onReset, canReorganize, onReorganize }: {
  canvasId: string;
  history: CanvasHistoryItem[];
  onHistory: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  title: string;
  scale: number;
  ready: boolean;
  onZoom: (factor: number) => void;
  onReset: () => void;
  canReorganize: boolean;
  onReorganize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const renaming = useRef(false);
  const editId = useRef<string | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { swipe, bind: bindSwipe } = useSwipeToDelete();
  useEffect(() => () => clearTimeout(openTimer.current), []);
  const nameOf = (id: string) => history.find(item => item.id === id)?.name || canvasTitle(id);
  const filteredHistory = history.filter((item) => nameOf(item.id).toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()));

  function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleExport(id = canvasId) {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const { blob, filename } = await exportProject(id);
      downloadBlob(filename, blob);
    } catch (error) {
      toast.add({
        title: "Could not export project",
        description: error instanceof Error ? error.message : "Please retry.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (busy || !ready) return;
    setBusy(true);
    try {
      const result = await importProject(file);
      toast.add({
        title: `Imported "${result.name}"`,
        description: `${result.itemCount} ${result.itemCount === 1 ? "file" : "files"} restored into a new canvas.`,
        type: "success",
      });
      onHistory();
      onOpen(result.canvasId);
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not import project",
        description: error instanceof Error ? error.message : "Please retry.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function startRename(item: CanvasHistoryItem) {
    if (renaming.current) return;
    clearTimeout(openTimer.current);
    setRenameError("");
    editId.current = item.id;
    setEditing(item.id);
    setDraft(item.name || (item.id === 'default' ? 'Original canvas' : 'Canvas'));
  }
  function cancelRename() { editId.current = null; setEditing(null); }
  async function saveRename() {
    const id = editId.current;
    if (!id || renaming.current || !ready) return;
    if (!draft.trim()) { cancelRename(); return; }
    renaming.current = true;
    setRenameError("");
    setBusy(true);
    try {
      await renameCanvas(id, draft);
      cancelRename();
      onHistory();
    } catch (error) {
      setRenameError(error instanceof Error && error.message ? error.message : "Could not rename canvas. Try again.");
    } finally {
      renaming.current = false;
      setBusy(false);
    }
  }

  return (
    <><ConfirmDelete open={deleting !== null} onOpenChange={(next) => { if (!next) setDeleting(null); }}
      title="Delete canvas?" description={`${deleting ? nameOf(deleting) : "This canvas"} and its chats, images and other files will be permanently deleted. Files used by other canvases will stay.`}
      disabled={!ready || busy} onConfirm={async () => { if (deleting) await onDelete(deleting); }} /><Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setZoomOpen(false); }}>
      <PopoverTrigger render={<Button size="icon-lg" className="fixed bottom-24 left-4 z-20 size-12 shadow-lg min-[900px]:bottom-6" />} aria-label={open ? "Close canvas menu" : "Open canvas menu"}>
        <span className={cn("transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", open && "rotate-90")}>
          {open ? <XIcon /> : <MenuIcon />}
        </span>
      </PopoverTrigger>
      <PopoverContent side="right" align="center" sideOffset={12} className="group/fab w-auto flex-row gap-3 overflow-visible bg-transparent p-0 shadow-none ring-0 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-open:animate-none data-closed:animate-none data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none">
        <PopoverTitle className="sr-only">Canvas menu</PopoverTitle>
        <Tip label="New canvas"><Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" disabled={!ready || busy} onClick={onNew} aria-label="New canvas"><FilePlusIcon /></Button></Tip>
        <Tip label="Import project"><Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" disabled={!ready || busy} onClick={() => fileInputRef.current?.click()} aria-label="Import project"><UploadIcon /></Button></Tip>
        <Tip label="Export project"><Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" disabled={!ready || busy} onClick={() => void handleExport()} aria-label="Export project"><DownloadIcon /></Button></Tip>
        <Tip label="Reorganize canvas"><Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" disabled={!ready || !canReorganize || busy} onClick={onReorganize} aria-label="Reorganize canvas"><LayoutGridIcon /></Button></Tip>
        <Popover onOpenChange={(next) => { if (next) { setHistorySearch(""); onHistory(); } }}>
          <Tip label={history.find(item => item.id === canvasId)?.name || title}><PopoverTrigger render={<Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" />} aria-label="Canvas history"><HistoryIcon /></PopoverTrigger></Tip>
          <PopoverContent side="top" align="start" sideOffset={10} className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-3">
            <PopoverTitle className="px-1">Canvas history</PopoverTitle>
            <InputGroup>
              <InputGroupInput aria-label="Search canvases" placeholder="Search canvases…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              {historySearch && <InputGroupAddon align="inline-end"><Tip label="Clear search"><InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setHistorySearch("")}><XIcon /></InputGroupButton></Tip></InputGroupAddon>}
            </InputGroup>
            <div className="-m-1 flex max-h-64 flex-col gap-1 overflow-y-auto p-1" aria-label="Saved canvases">
              {filteredHistory.map((item) => {
                const offset = swipe?.id === item.id ? swipe.offset : undefined;
                const swipeHandlers = bindSwipe(item.id, ready && !busy, () => setDeleting(item.id));
                return (
                <div key={item.id}>{editing === item.id ? <div className="flex flex-col gap-1"><Input autoFocus readOnly={busy} aria-invalid={!!renameError} aria-label="Canvas name" maxLength={200} value={draft} onFocus={event => event.target.select()} onChange={event => { setDraft(event.target.value); setRenameError(""); }} onBlur={() => void saveRename()} onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
                  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!renaming.current) cancelRename(); }
                }} />{renameError && <div className="flex items-center gap-2"><p role="alert" className="text-xs text-destructive">{renameError}</p><Button size="xs" variant="outline" disabled={busy} onClick={() => void saveRename()}>Retry</Button></div>}</div> : <div className="relative overflow-hidden rounded-xl">
                {offset !== undefined && <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 flex items-center justify-end pr-2 text-destructive motion-safe:transition-colors", offset <= swipeDeleteThreshold ? "bg-destructive/20" : "bg-destructive/10")}><Trash2Icon className="size-4" /></div>}
                <Button variant={item.id === canvasId ? "secondary" : "ghost"} className={cn("relative h-auto w-full touch-pan-y justify-start gap-3 rounded-xl px-3 py-2.5 pr-10 text-left disabled:opacity-100", offset !== undefined && "rounded-none bg-popover bg-clip-border transition-none hover:bg-popover active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-popover")} disabled={!ready || busy} aria-current={item.id === canvasId ? "true" : undefined}
                title="Drag left to delete, or press Delete"
                style={offset !== undefined ? { transform: `translateX(${offset}px)` } : undefined}
                {...swipeHandlers}
                onPointerMoveCapture={event => {
                  swipeHandlers.onPointerMoveCapture(event);
                  if (event.defaultPrevented) clearTimeout(openTimer.current);
                }}
                onClick={event => {
                  clearTimeout(openTimer.current);
                  if (item.id === canvasId) return;
                  if (event.detail === 0) onOpen(item.id);
                  else openTimer.current = setTimeout(() => onOpen(item.id), 500);
                }} onDoubleClick={() => startRename(item)} onKeyDown={event => {
                  if (event.key === "F2") { event.preventDefault(); startRename(item); }
                  if (event.key === "Delete") { event.preventDefault(); clearTimeout(openTimer.current); setDeleting(item.id); }
                }}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{item.name || (item.id === "default" ? "Original canvas" : "Canvas")}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{item.id !== "default" && `${canvasTitle(item.id).replace("Canvas · ", "")} · `}{item.count} {item.count === 1 ? "file" : "files"}</span>
                  </span>
                </Button>
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <DropdownMenu onOpenChange={(next) => { if (next) clearTimeout(openTimer.current); }}>
                    <Tip label={`Actions for ${nameOf(item.id)}`}>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="size-7 rounded-lg" disabled={!ready || busy} aria-label={`Actions for ${nameOf(item.id)}`} />}>
                        <EllipsisIcon />
                      </DropdownMenuTrigger>
                    </Tip>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => startRename(item)}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleExport(item.id)}><DownloadIcon />Export</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(item.id)}><Trash2Icon />Delete</DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div></div>}</div>
                );
              })}
              {filteredHistory.length === 0 && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{history.length === 0 ? "No saved canvases yet." : "No canvases found."}</p>}
            </div>
          </PopoverContent>
        </Popover>
        <div className="transition-[translate,scale,opacity] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-starting-style/fab:-translate-x-6 group-data-starting-style/fab:scale-75 group-data-starting-style/fab:opacity-0 group-data-ending-style/fab:-translate-x-6 group-data-ending-style/fab:scale-75 group-data-ending-style/fab:opacity-0 motion-reduce:transition-none">
          <SettingsDialog />
        </div>
        <div className="transition-[translate,scale,opacity] duration-250 delay-50 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-starting-style/fab:-translate-x-12 group-data-starting-style/fab:scale-75 group-data-starting-style/fab:opacity-0 group-data-ending-style/fab:-translate-x-12 group-data-ending-style/fab:scale-75 group-data-ending-style/fab:opacity-0 motion-reduce:transition-none">
          <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
            <Tip label="Zoom"><PopoverTrigger render={<Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover text-popover-foreground shadow-sm" />} aria-label="Zoom">
              <SearchIcon />
            </PopoverTrigger></Tip>
            <PopoverContent side="right" align="center" sideOffset={12} className="w-auto p-1">
              <PopoverTitle className="sr-only">Canvas zoom</PopoverTitle>
              <div role="group" aria-label="Canvas zoom" className="flex items-center gap-1">
                <Tip label="Zoom out"><Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!ready || scale <= 0.2} onClick={() => onZoom(1 / 1.25)}><MinusIcon /></Button></Tip>
                <Tip label="Reset view to 100%"><Button variant="ghost" size="sm" className="min-w-16 tabular-nums" aria-label="Reset canvas view" disabled={!ready} onClick={onReset}>{Math.round(scale * 100)}%</Button></Tip>
                <Tip label="Zoom in"><Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={!ready || scale >= 4} onClick={() => onZoom(1.25)}><PlusIcon /></Button></Tip>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </PopoverContent>
    </Popover>
    <input
      ref={fileInputRef}
      type="file"
      accept=".lomra,.zip,application/zip"
      className="hidden"
      aria-hidden="true"
      onChange={handleImport}
    /></>
  );
}
