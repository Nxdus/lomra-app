"use client";

import { useState } from "react";
import { DownloadIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { HunyuanIcon } from "@/components/hunyuan-icon";
import { LocalModelRow } from "@/components/local-model-row";
import { TripoIcon } from "@/components/tripo-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { useLocal3d } from "@/hooks/use-local3d";
import { localModelSize } from "@/components/ollama-settings";
import type { Local3dModel } from "@/lib/desktop";

const stageLabel = { download: "Downloading", python: "Setting up Python", packages: "Installing libraries", model: "Downloading model" } as const;

/** Settings → Local models: image-to-3D models (Hunyuan3D, TripoSR) that run on this computer. */
export function Local3dSettings() {
  const { status, install, cancel, remove } = useLocal3d();
  const [confirming, setConfirming] = useState<Local3dModel | null>(null);
  const [removing, setRemoving] = useState<Local3dModel | null>(null);
  const job = status?.installing ?? null;
  const queued = status?.queued ?? [];
  const percent = job && job.total > 0 ? Math.min(100, Math.round(job.received / job.total * 100)) : null;
  const ready = status?.supported ? status : null;
  const hasInstalledModel = !!ready?.engine && ready.models.some((model) => model.installed && model.fits);
  const statusLabel = status === undefined ? "Checking…" : status === null ? "Desktop app required"
    : !status.supported ? "Unavailable" : job ? `Downloading…${queued.length ? ` ${queued.length} waiting` : ""}` : hasInstalledModel ? "Ready" : "No models installed";
  const downloadBytes = confirming ? confirming.bytes + (ready?.engine ? 0 : ready?.engineBytes ?? 0) : 0;

  async function start(model: Local3dModel) {
    if (!await install(model.id)) toast.add({ title: "Could not start the download.", type: "error" });
  }

  return <section aria-labelledby="local3d-heading" className="flex flex-col gap-3">
    <ConfirmDelete open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={removing?.partial ? "Delete unfinished download?" : "Remove 3D model?"}
      description={removing?.partial ? `The ${localModelSize(removing.partial)} downloaded so far of “${removing.name}” will be deleted from this computer.` : `“${removing?.name}” will be deleted from this computer. You can download it again later.`}
      onConfirm={async () => { if (removing) try { await remove(removing.id); } catch (error) { toast.add({ title: error instanceof Error ? error.message : "Could not remove the model", type: "error" }); } }} />

    <Dialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Download {confirming?.name}?</DialogTitle>
          <DialogDescription>
            About {localModelSize(downloadBytes)} will be downloaded{ready?.engine ? "" : " (including the 3D engine)"}. You can keep using Lomra meanwhile.{job ? " It starts after the other downloads." : ""} License: {confirming?.license}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirming(null)}>Not now</Button>
          <Button autoFocus onClick={() => { const model = confirming; setConfirming(null); if (model) void start(model); }}>Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="flex shrink-0 gap-1 text-muted-foreground">
        <HunyuanIcon className="size-5" />
        <TripoIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="local3d-heading" className="text-sm font-semibold">3D models</h2>
          <p className="text-xs text-muted-foreground">Local image-to-3D models</p>
        </div>
        <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${hasInstalledModel && !job ? "bg-primary" : "bg-muted-foreground/40"}`} />
          <span>{statusLabel}</span>
        </div>
      </div>
    </div>

    {status === undefined ? null
    : status === null ? <p className="text-xs text-muted-foreground">Local 3D models need the Lomra desktop app (restart it if you just updated).</p>
    : !status.supported ? <p className="text-xs text-muted-foreground">{status.reason ?? "Local 3D generation is not available for this computer."}</p>
    : <>
      <ul className="divide-y">
        {status.models.map((model) => {
          const installing = job?.id === model.id;
          const waiting = queued.some(({ id }) => id === model.id);
          const paused = !installing && !waiting && model.partial > 0;
          const modelStatus = installing ? "Downloading" : waiting ? "Waiting to download" : paused ? `Paused, ${localModelSize(model.partial)} downloaded` : !model.fits ? "Needs more graphics memory" : model.installed ? "Installed" : undefined;
          const action = installing
            ? { label: "Stop download", icon: <XIcon aria-hidden="true" />, onClick: () => void cancel(model.id) }
            : waiting ? { label: "Cancel download", icon: <XIcon aria-hidden="true" />, onClick: () => void cancel(model.id) }
            : model.installed ? { label: "Remove", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) }
            : !model.fits ? undefined
            // The user agreed to this download before; ask again only if it now includes the engine.
            : paused ? { label: "Resume download", icon: <PlayIcon aria-hidden="true" />, onClick: () => ready?.engine ? void start(model) : setConfirming(model) }
            : { label: "Download", icon: <DownloadIcon aria-hidden="true" />, onClick: () => setConfirming(model) };
          const secondary = paused ? { label: "Delete unfinished download", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) } : undefined;
          return <li key={model.id}>
            <LocalModelRow name={model.name} description={`${model.quality} · ${model.note}`}
              size={localModelSize(model.bytes)} status={modelStatus} action={action} secondary={secondary} />
          </li>;
        })}
      </ul>
      {job && <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{stageLabel[job.stage]} · {job.label}{job.total > 0 && ` · ${localModelSize(job.received)} of ${localModelSize(job.total)}`}</span>
          {percent !== null && <span className="shrink-0">{percent}%</span>}
        </div>
        <Progress value={percent} aria-label={`Downloading ${job.name}`} />
      </div>}
      {status.error && <p role="alert" className="whitespace-pre-line text-xs text-destructive">{status.error}</p>}
    </>}
  </section>;
}
