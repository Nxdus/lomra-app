"use client";

import { useState } from "react";
import { DownloadIcon, PlayIcon, ScanIcon, Trash2Icon, XIcon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { LocalModelRow } from "@/components/local-model-row";
import { localModelSize } from "@/components/ollama-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { usePictureAi } from "@/hooks/use-picture-ai";
import type { PictureAiModel } from "@/lib/desktop";

/** Settings → Local models: local background removal and upscaling models that run on CPU. */
export function PictureAiSettings() {
  const { status, download, cancel, remove } = usePictureAi();
  const [confirming, setConfirming] = useState<PictureAiModel | null>(null);
  const [removing, setRemoving] = useState<PictureAiModel | null>(null);
  const job = status?.downloading ?? null;
  const queued = status?.queued ?? [];
  const percent = job && job.total > 0 ? Math.min(100, Math.round(job.received / job.total * 100)) : 0;
  const ready = !!status?.supported && status.models.some((model) => model.installed);
  const statusLabel = status === undefined ? "Checking…" : status === null ? "Desktop app required"
    : job ? `Downloading…${queued.length ? ` ${queued.length} waiting` : ""}` : ready ? "Ready" : "No models installed";

  async function start(id: string) {
    if (!await download(id)) toast.add({ title: "Could not start the download.", type: "error" });
  }

  return <section aria-labelledby="picture-ai-heading" className="flex flex-col gap-3">
    <ConfirmDelete
      open={!!removing}
      onOpenChange={(open) => { if (!open) setRemoving(null); }}
      title={removing?.partial ? "Delete unfinished download?" : "Remove picture tool model?"}
      description={removing?.partial ? `The ${localModelSize(removing.partial)} downloaded so far of “${removing.name}” will be deleted from this computer.` : `“${removing?.name}” will be deleted from this computer. You can download it again later.`}
      onConfirm={async () => { if (removing) try { await remove(removing.id); } catch (error) { toast.add({ title: error instanceof Error ? error.message : "Could not remove the model", type: "error" }); } }}
    />

    <Dialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Download {confirming?.name}?</DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            {confirming && <>
              <span>{confirming.note}</span>
              <span className="text-xs">License: {confirming.license}.{job ? " Starts after the current download." : ""}</span>
            </>}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirming(null)}>Not now</Button>
          <Button autoFocus onClick={() => { const model = confirming; setConfirming(null); if (model) void start(model.id); }}>Download {confirming && localModelSize(confirming.bytes)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <div className="flex items-center gap-3">
      <ScanIcon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="picture-ai-heading" className="text-sm font-semibold">Picture tools</h2>
          <p className="text-xs text-muted-foreground">Local background removal and upscaling</p>
        </div>
        <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${ready && !job ? "bg-primary" : "bg-muted-foreground/40"}`} />
          <span>{statusLabel}</span>
        </div>
      </div>
    </div>
    {status?.error && <p role="alert" className="whitespace-pre-line text-xs text-destructive">{status.error}</p>}

    {status === undefined ? null
    : status === null ? <p className="text-xs text-muted-foreground">Local background removal and upscaling need the Lomra desktop app (restart it if you just updated).</p>
    : <>
      <ul className="divide-y">
        {status.models.map((model) => {
          const installing = job?.id === model.id;
          const waiting = queued.some(({ id }) => id === model.id);
          const paused = !installing && !waiting && model.partial > 0;
          const modelStatus = installing ? `Downloading · ${percent}%` : waiting ? "Waiting to download" : paused ? `Paused, ${localModelSize(model.partial)} downloaded` : model.installed ? "Installed" : undefined;
          const action = installing
            ? { label: "Stop download", icon: <XIcon aria-hidden="true" />, onClick: () => void cancel(model.id) }
            : waiting ? { label: "Cancel download", icon: <XIcon aria-hidden="true" />, onClick: () => void cancel(model.id) }
            : model.installed ? { label: "Remove", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) }
            : paused ? { label: "Resume download", icon: <PlayIcon aria-hidden="true" />, onClick: () => void start(model.id) }
            : { label: "Download", icon: <DownloadIcon aria-hidden="true" />, onClick: () => setConfirming(model) };
          const secondary = paused ? { label: "Delete unfinished download", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) } : undefined;
          return <li key={model.id}>
            <LocalModelRow
              name={model.name}
              description={`${model.quality} · ${model.license}`}
              size={localModelSize(model.bytes)}
              status={modelStatus}
              action={action}
              secondary={secondary}
            />
          </li>;
        })}
      </ul>
      {job && <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">Downloading {job.name} · {localModelSize(job.received)} of {localModelSize(job.total)}</span>
          <span className="shrink-0">{percent}%</span>
        </div>
        <Progress value={percent} aria-label={`Downloading ${job.name}`} className="[&_[data-slot=progress-track]]:h-1.5" />
      </div>}
    </>}
  </section>;
}
