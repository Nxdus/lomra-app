"use client";

import { useState } from "react";
import { DownloadIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { LocalModelRow } from "@/components/local-model-row";
import { SdHuggingFace } from "@/components/sd-huggingface";
import { StabilityIcon } from "@/components/stability-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { useSd } from "@/hooks/use-sd";
import { localModelSize } from "@/components/ollama-settings";
import type { SdDownloadRequest, SdModel } from "@/lib/desktop";

/** Settings → Local models: Stable Diffusion models that make pictures on this computer. `search` is looked for on Hugging Face right away. */
export function SdSettings({ search }: { search?: string }) {
  const { status, download, cancel, remove } = useSd();
  const [confirming, setConfirming] = useState<SdModel | null>(null);
  const [removing, setRemoving] = useState<SdModel | null>(null);
  const job = status?.downloading ?? null;
  const queued = status?.queued ?? [];
  const models = status?.models.filter((model) => model.id !== job?.id && !queued.some(({ id }) => id === model.id)) ?? [];
  const percent = job && job.total > 0 ? Math.min(100, Math.round(job.received / job.total * 100)) : 0;
  const ready = !!status?.supported && status.engine && status.models.some((model) => model.installed);
  const statusLabel = status === undefined ? "Checking…" : status === null ? "Desktop app required"
    : !status.supported ? "Unavailable" : job ? `Downloading…${queued.length ? ` ${queued.length} waiting` : ""}` : ready ? "Ready" : "No models installed";

  async function start(request: SdDownloadRequest) {
    if (!await download(request)) toast.add({ title: "Could not start the download.", type: "error" });
  }

  return <section aria-labelledby="sd-heading" className="flex flex-col gap-3">
    <ConfirmDelete open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={removing?.partial ? "Delete unfinished download?" : "Remove image model?"}
      description={removing?.partial ? `The ${localModelSize(removing.partial)} downloaded so far of “${removing.name}” will be deleted from this computer.` : `“${removing?.name}” will be deleted from this computer. You can download it again later.`}
      onConfirm={async () => { if (removing) try { await remove(removing.id); } catch (error) { toast.add({ title: error instanceof Error ? error.message : "Could not remove the model", type: "error" }); } }} />

    <Dialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Download {confirming?.name}?</DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            {confirming && <>
              <span>{confirming.note}</span>
              <span className="text-xs">{[!status?.engine && `+${localModelSize(status?.engineBytes ?? 0)} image engine`, job && "Starts after the other downloads"].filter(Boolean).join(" · ")}</span>
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
      <StabilityIcon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="sd-heading" className="text-sm font-semibold">Stable Diffusion</h2>
          <p className="text-xs text-muted-foreground">Local image models</p>
        </div>
        <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${ready && !job ? "bg-primary" : "bg-muted-foreground/40"}`} />
          <span>{statusLabel}</span>
        </div>
      </div>
    </div>
    {status?.error && <p role="alert" className="whitespace-pre-line text-xs text-destructive">{status.error}</p>}

    {status === undefined ? null
    : status === null ? <p className="text-xs text-muted-foreground">Local image models need the Lomra desktop app (restart it if you just updated).</p>
    : !status.supported ? <p className="text-xs text-muted-foreground">Local image generation is not available for this computer yet.</p>
    : <>
    <ul className="divide-y">
      {job && <li className="pb-2">
        <LocalModelRow name={job.name}
          description={`${job.stage === "engine" ? "Downloading image engine" : "Downloading model"} · ${localModelSize(job.received)} of ${localModelSize(job.total)}`}
          size={`${percent}%`}
          action={{ label: "Stop download", icon: <XIcon aria-hidden="true" />, onClick: () => void cancel(job.id) }} />
        <Progress value={percent} aria-label={`Downloading ${job.name}`} className="[&_[data-slot=progress-track]]:h-1.5" />
      </li>}
      {queued.map((item) => {
        const model = status.models.find(({ id }) => id === item.id);
        return <li key={item.id}>
          <LocalModelRow name={item.name} description={model?.quality ?? "Hugging Face"} size={model ? localModelSize(model.bytes) : ""}
            status="Waiting to download"
            action={{ label: "Cancel download", icon: <XIcon aria-hidden="true" />, onClick: () => void cancel(item.id) }} />
        </li>;
      })}
      {models.map((model) => <li key={model.id}>
        <LocalModelRow name={model.name}
          description={[model.quality, model.inpaint && "Inpainting", model.custom && model.note].filter(Boolean).join(" · ")}
          size={localModelSize(model.bytes)}
          status={model.installed ? "Installed" : model.partial ? `Paused, ${localModelSize(model.partial)} downloaded` : undefined}
          secondary={model.partial
            ? { label: "Delete unfinished download", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) } : undefined}
          action={model.installed ? { label: "Remove", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) }
            // The user agreed to this download before; ask again only if it now includes the engine.
            : model.partial ? { label: "Resume download", icon: <PlayIcon aria-hidden="true" />, onClick: () => status.engine ? void start(model.id) : setConfirming(model) }
            : { label: "Download", icon: <DownloadIcon aria-hidden="true" />, onClick: () => setConfirming(model) }} />
      </li>)}
    </ul>
    <SdHuggingFace status={status} onDownload={start} initialQuery={search} />
    </>}
  </section>;
}
