"use client";

import { useState } from "react";
import { CheckIcon, HistoryIcon, FilePlusIcon, MenuIcon, MinusIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiSettings } from "@/components/api-settings";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { canvasTitle } from "@/lib/image-canvas/image-canvas-storage";
import { cn } from "@/lib/utils";

export function CanvasMenu({ canvasId, history, onHistory, onNew, onOpen, onDelete, title, scale, ready, onZoom, onReset }: {
  canvasId: string;
  history: { id: string; count: number }[];
  onHistory: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  title: string;
  scale: number;
  ready: boolean;
  onZoom: (factor: number) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filteredHistory = history.filter((item) => canvasTitle(item.id).toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()));

  return (
    <><Dialog open={deleting !== null} onOpenChange={(next) => { if (!next && !busy) setDeleting(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Delete canvas?</DialogTitle><DialogDescription>{deleting && canvasTitle(deleting)} and its chats, images and other files will be permanently deleted. Files used by other canvases will stay.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy || !ready} onClick={async () => {
          if (!deleting) return;
          setBusy(true);
          try { await onDelete(deleting); setDeleting(null); } catch { /* The canvas displays the storage error. */ } finally { setBusy(false); }
        }}>{busy ? "Deleting…" : "Delete canvas"}</Button></DialogFooter>
      </DialogContent>
    </Dialog><Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setZoomOpen(false); }}>
      <PopoverTrigger render={<Button size="icon-lg" className="fixed bottom-24 left-4 z-20 size-12 shadow-lg min-[900px]:bottom-6" />} aria-label={open ? "Close canvas menu" : "Open canvas menu"}>
        <span className={cn("transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", open && "rotate-90")}>
          {open ? <XIcon /> : <MenuIcon />}
        </span>
      </PopoverTrigger>
      <PopoverContent side="right" align="center" sideOffset={12} className="group/fab w-auto flex-row gap-3 bg-transparent p-0 shadow-none ring-0 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-open:animate-none data-closed:animate-none data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none">
        <PopoverTitle className="sr-only">Canvas menu</PopoverTitle>
        <Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" disabled={!ready} onClick={onNew} aria-label="New canvas" title="New canvas"><FilePlusIcon /></Button>
        <Popover onOpenChange={(next) => { if (next) { setHistorySearch(""); onHistory(); } }}>
          <PopoverTrigger render={<Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover" />} aria-label="Canvas history" title={title}><HistoryIcon /></PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={10} className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-3">
            <PopoverTitle className="px-1">Canvas history</PopoverTitle>
            <InputGroup>
              <InputGroupInput aria-label="Search canvases" placeholder="Search canvases…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              {historySearch && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setHistorySearch("")}><XIcon /></InputGroupButton></InputGroupAddon>}
            </InputGroup>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="Saved canvases">
              {filteredHistory.map((item) => (
                <div key={item.id} className="flex items-center gap-1"><Button variant={item.id === canvasId ? "secondary" : "ghost"} className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-xl px-3 py-2.5 text-left disabled:opacity-100" disabled={!ready || item.id === canvasId} aria-current={item.id === canvasId ? "true" : undefined} onClick={() => onOpen(item.id)}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{item.id === "default" ? "Original canvas" : "Canvas"}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{item.id !== "default" && `${canvasTitle(item.id).replace("Canvas · ", "")} · `}{item.count} {item.count === 1 ? "file" : "files"}</span>
                  </span>
                  {item.id === canvasId && <CheckIcon data-icon="inline-end" aria-label="Current canvas" />}
                </Button><Button variant="ghost" size="icon-sm" disabled={!ready || busy} aria-label={`Delete ${canvasTitle(item.id)}`} onClick={() => setDeleting(item.id)}><Trash2Icon /></Button></div>
              ))}
              {filteredHistory.length === 0 && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{history.length === 0 ? "No saved canvases yet." : "No canvases found."}</p>}
            </div>
          </PopoverContent>
        </Popover>
        <div className="transition-[translate,scale,opacity] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-starting-style/fab:-translate-x-6 group-data-starting-style/fab:scale-75 group-data-starting-style/fab:opacity-0 group-data-ending-style/fab:-translate-x-6 group-data-ending-style/fab:scale-75 group-data-ending-style/fab:opacity-0 motion-reduce:transition-none">
          <ApiSettings />
        </div>
        <div className="transition-[translate,scale,opacity] duration-250 delay-50 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-starting-style/fab:-translate-x-12 group-data-starting-style/fab:scale-75 group-data-starting-style/fab:opacity-0 group-data-ending-style/fab:-translate-x-12 group-data-ending-style/fab:scale-75 group-data-ending-style/fab:opacity-0 motion-reduce:transition-none">
          <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
            <PopoverTrigger render={<Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover text-popover-foreground shadow-sm" />} aria-label="Zoom" title="Zoom">
              <SearchIcon />
            </PopoverTrigger>
            <PopoverContent side="right" align="center" sideOffset={12} className="w-auto p-1">
              <PopoverTitle className="sr-only">Canvas zoom</PopoverTitle>
              <div role="group" aria-label="Canvas zoom" className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!ready || scale <= 0.2} onClick={() => onZoom(1 / 1.25)}><MinusIcon /></Button>
                <Button variant="ghost" size="sm" className="min-w-16 tabular-nums" aria-label="Reset canvas view" title="Reset view to 100%" disabled={!ready} onClick={onReset}>{Math.round(scale * 100)}%</Button>
                <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={!ready || scale >= 4} onClick={() => onZoom(1.25)}><PlusIcon /></Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </PopoverContent>
    </Popover></>
  );
}
