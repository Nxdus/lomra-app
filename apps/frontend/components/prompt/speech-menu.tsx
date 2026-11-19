"use client";

import { useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { CheckIcon, DownloadIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "@/components/ui/context-menu";
import { toast } from "@/components/ui/toast";
import { useSpeechModel } from "@/hooks/use-speech-model";
import { desktopSpeech, type SpeechModel } from "@/lib/desktop";
import { speechSize as size, useSpeechDownload } from "./speech-download";

type Catalog = Awaited<ReturnType<NonNullable<ReturnType<typeof desktopSpeech>>["models"]>>;

const noSubscription = () => () => {};

const DELETE_DISTANCE = 120;

/** One model: click to download or use it; drag a downloaded one to the left (or press Delete) to remove it (with confirmation). */
function ModelRow({ model, used, downloading, onPick, onDelete }: { model: SpeechModel; used: boolean; downloading: boolean; onPick: () => void; onDelete: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const dragged = useRef(false);
  const installed = model.installed;
  const active = installed && used;
  return <div className="relative overflow-hidden rounded-xl">
    {dx < 0 && <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-end rounded-xl pr-2 text-destructive motion-safe:transition-colors ${dx <= -DELETE_DISTANCE ? "bg-destructive/20" : "bg-destructive/10"}`}>
      <Trash2Icon className="size-4 shrink-0" />
    </div>}
  <ContextMenuItem disabled={downloading} title={model.note} className={installed ? "touch-pan-y bg-popover" : undefined} style={dx ? { transform: `translateX(${dx}px)` } : undefined}
    onClick={(event) => { if (dragged.current) { event.preventBaseUIHandler(); dragged.current = false; } else onPick(); }}
    onKeyDown={(event) => { if (model.installed && (event.key === "Delete" || event.key === "Backspace")) onDelete(); }}
    onPointerDown={(event) => { if (model.installed) { start.current = event.clientX; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId); } }}
    onPointerMove={(event) => {
      if (start.current === null) return;
      const next = Math.max(-160, Math.min(0, event.clientX - start.current));
      if (next < -6) dragged.current = true;
      setDx(next);
    }}
    onPointerUp={() => { const done = dx <= -DELETE_DISTANCE; start.current = null; setDx(0); if (done) onDelete(); }}
    onPointerCancel={() => { start.current = null; setDx(0); }}>
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {downloading ? "Downloading…" : `${model.recommended ? "Recommended" : model.quality} · ${size(model.bytes)}`}
      </span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {downloading ? <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />
          : active ? <CheckIcon aria-hidden="true" />
          : !installed ? <DownloadIcon aria-hidden="true" /> : null}
      </span>
      <span className="sr-only">{model.note} {downloading ? "" : active ? "In use" : installed ? "Installed" : "Download"}</span>
  </ContextMenuItem>
  </div>;
}

/** Right-click the microphone to see the speech models, download one, choose which is used, or delete it. Desktop only. */
export function SpeechMenu({ children }: { children: ReactElement }) {
  const available = useSyncExternalStore(noSubscription, () => Boolean(desktopSpeech()), () => false);
  const { model: chosen, choose } = useSpeechModel();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<SpeechModel | null>(null);
  const { ask, dialog } = useSpeechDownload();
  if (!available) return children;
  const bridge = desktopSpeech()!;
  const used = chosen ?? catalog?.models.find((model) => model.recommended)?.id;

  async function download(model: SpeechModel) {
    try {
      if (!await ask(model.id)) return;
      await choose(model.id);
      toast.add({ title: `Downloading ${model.name} (${size(model.bytes)})`, description: "Voice input uses it when the download finishes." });
    } catch {
      toast.add({ title: `Could not download ${model.name}`, type: "error" });
    }
  }

  async function remove(model: SpeechModel) {
    try {
      await bridge.deleteModel(model.id);
      toast.add({ title: `Deleted ${model.name}` });
    } catch {
      toast.add({ title: `Could not delete ${model.name}`, type: "error" });
    }
  }

  return <>
    <ContextMenu open={open} onOpenChange={(next) => { setOpen(next); if (next) void bridge.models().then(setCatalog, () => setCatalog(null)); }}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent side="top" align="end" aria-label="Speech models" className="w-80 max-w-[calc(100vw-2rem)]">
        <ContextMenuGroup>
          <ContextMenuLabel>Speech models</ContextMenuLabel>
          {catalog === undefined && <ContextMenuItem disabled>Loading models…</ContextMenuItem>}
          {catalog === null && <ContextMenuItem disabled>Voice input uses an external Whisper server</ContextMenuItem>}
          {catalog?.models.map((model) => <ModelRow key={model.id} model={model} used={model.id === used} downloading={catalog.downloading === model.id}
            onPick={() => model.installed
              ? void choose(model.id).catch(() => toast.add({ title: "Could not save the choice", type: "error" }))
              : void download(model)}
            onDelete={() => { setOpen(false); setDeleting(model); }} />)}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
    {dialog}
    <ConfirmDelete open={deleting !== null} onOpenChange={(next) => { if (!next) setDeleting(null); }}
      title={`Delete ${deleting?.name ?? "the speech model"}?`}
      description="It will be removed from this computer."
      onConfirm={async () => { if (deleting) await remove(deleting); }} />
  </>;
}
