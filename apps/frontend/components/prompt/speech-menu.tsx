"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
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
function ModelRow({ Item, model, used, downloading, onPick, onDelete }: { Item: typeof ContextMenuItem; model: SpeechModel; used: boolean; downloading: boolean; onPick: () => void; onDelete?: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const dragged = useRef(false);
  const installed = model.installed;
  const active = installed && used;
  return <div className="relative overflow-hidden rounded-xl">
    {dx < 0 && <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-end rounded-xl pr-2 text-destructive motion-safe:transition-colors ${dx <= -DELETE_DISTANCE ? "bg-destructive/20" : "bg-destructive/10"}`}>
      <Trash2Icon className="size-4 shrink-0" />
    </div>}
  <Item disabled={downloading} title={model.note} className={installed ? "touch-pan-y bg-popover" : undefined} style={dx ? { transform: `translateX(${dx}px)` } : undefined}
    onClick={(event) => { if (dragged.current) { event.preventBaseUIHandler(); dragged.current = false; } else onPick(); }}
    onKeyDown={(event) => { if (model.installed && (event.key === "Delete" || event.key === "Backspace")) onDelete?.(); }}
    onPointerDown={(event) => { if (onDelete) { start.current = event.clientX; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId); } }}
    onPointerMove={(event) => {
      if (start.current === null) return;
      const next = Math.max(-160, Math.min(0, event.clientX - start.current));
      if (next < -6) dragged.current = true;
      setDx(next);
    }}
    onPointerUp={() => { const done = dx <= -DELETE_DISTANCE; start.current = null; setDx(0); if (done) onDelete?.(); }}
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
  </Item>
  </div>;
}

/** Right-click the microphone to see the speech models, download one, choose which is used, or delete it. Desktop only. */
export function SpeechMenu({ children }: { children: ReactElement }) {
  const available = useSyncExternalStore(noSubscription, () => Boolean(desktopSpeech()), () => false);
  const { model: chosen, choose } = useSpeechModel();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [catalogError, setCatalogError] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const tracking = useRef<SpeechModel | null>(null);
  const [menu, setMenu] = useState(false);
  const lastRefresh = useRef(0);
  const [deleting, setDeleting] = useState<SpeechModel | null>(null);
  const { ask, dialog } = useSpeechDownload();
  const bridge = available ? desktopSpeech() : undefined;
  const refresh = useCallback(async () => {
    if (!bridge) return;
    const request = ++lastRefresh.current;
    try {
      const next = await bridge.models();
      if (request !== lastRefresh.current) return;
      setCatalog(next);
      setCatalogError(false);
      if (!tracking.current && next?.downloading) {
        tracking.current = next.models.find((item) => item.id === next.downloading) ?? null;
      }
      const model = tracking.current;
      if (model && next && next.downloading !== model.id) {
        tracking.current = null;
        if (!next.models.some((item) => item.id === model.id && item.installed)) {
          setDownloadError(`Download failed for ${model.name}. Select it to try again.`);
        }
      }
    } catch {
      if (request === lastRefresh.current) setCatalogError(true);
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge || (!menu && !catalog?.downloading)) return;
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [bridge, menu, catalog?.downloading, refresh]);

  if (!bridge) return children;
  const used = chosen ?? catalog?.models.find((model) => model.recommended)?.id;

  async function download(model: SpeechModel) {
    try {
      if (!await ask(model.id)) return;
      tracking.current = model;
      setDownloadError("");
      await refresh();
      await choose(model.id).catch(() => toast.add({ title: "Could not save the choice", type: "error" }));
      toast.add({ title: `Download requested for ${model.name}`, description: "Voice input uses the model when the download finishes." });
    } catch {
      toast.add({ title: `Could not download ${model.name}`, type: "error" });
    }
  }

  async function remove(model: SpeechModel) {
    if (!await bridge?.deleteModel(model.id)) throw new Error(`Could not remove ${model.name}.`);
    await refresh();
    toast.add({ title: `Removed ${model.name}` });
  }

  function openMenu(open: boolean) {
    setMenu(open);
    if (open) void refresh();
  }

  function beginRemove(model: SpeechModel) {
    setMenu(false);
    setDeleting(model);
  }

  function menuItems(Item: typeof ContextMenuItem) {
    return <>
      {catalogError && <Item closeOnClick={false} onClick={() => void refresh()}>Could not load models. Retry</Item>}
      {downloadError && <Item disabled>{downloadError}</Item>}
      {!catalogError && catalog === undefined && <Item disabled>Loading models…</Item>}
      {!catalogError && catalog === null && <Item disabled>Voice input uses an external Whisper server</Item>}
      {catalog?.models.length === 0 && <Item disabled>No speech models available</Item>}
      {catalog?.models.map((model) => <Fragment key={model.id}>
        <ModelRow Item={Item} model={model} used={model.id === used} downloading={catalog.downloading === model.id}
          onPick={() => model.installed
            ? void choose(model.id).catch(() => toast.add({ title: "Could not save the choice", type: "error" }))
            : void download(model)}
          onDelete={model.installed && !catalog.downloading ? () => beginRemove(model) : undefined} />
        {model.installed && <Item variant="destructive" disabled={!!catalog.downloading} onClick={() => beginRemove(model)}>
          <Trash2Icon aria-hidden="true" /> Remove {model.name}…
        </Item>}
      </Fragment>)}
    </>;
  }

  return <>
    <ContextMenu open={menu} onOpenChange={openMenu}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent side="top" align="end" aria-label="Speech models" className="w-80 max-w-[calc(100vw-2rem)]">
        <ContextMenuGroup>
          <ContextMenuLabel>Speech models</ContextMenuLabel>
          {menuItems(ContextMenuItem)}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
    {dialog}
    <ConfirmDelete open={deleting !== null} onOpenChange={(next) => { if (!next) setDeleting(null); }}
      actionLabel="Remove"
      title={`Remove ${deleting?.name ?? "the speech model"}?`}
      description="It will be removed from this computer."
      onConfirm={async () => { if (deleting) await remove(deleting); }} />
  </>;
}
