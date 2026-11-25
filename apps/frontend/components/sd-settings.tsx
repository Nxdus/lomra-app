"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, FolderOpenIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { LocalModelRow } from "@/components/local-model-row";
import { SdHuggingFace } from "@/components/sd-huggingface";
import { SdLocalDialog } from "@/components/sd-local-dialog";
import { StabilityIcon } from "@/components/stability-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useSd } from "@/hooks/use-sd";
import { localModelSize } from "@/components/ollama-settings";
import { desktopSd, type SdDownloadRequest, type SdLocalCandidate, type SdModel } from "@/lib/desktop";

/** Settings → Local models: Stable Diffusion models that make pictures on this computer. `search` is looked for on Hugging Face right away. */
export function SdSettings({ search }: { search?: string }) {
  const { status, refresh, download, cancel, remove, setProfile } = useSd();
  const [confirming, setConfirming] = useState<SdModel | null>(null);
  const [removing, setRemoving] = useState<SdModel | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [local, setLocal] = useState<{ files: SdLocalCandidate[]; replacing?: string }>();
  const job = status?.downloading ?? null;
  const queued = status?.queued ?? [];
  const models = status?.models.filter((model) => model.id !== job?.id && !queued.some(({ id }) => id === model.id)) ?? [];
  const percent = job && job.total > 0 ? Math.min(100, Math.round(job.received / job.total * 100)) : 0;
  const ready = !!status?.supported && status.engine && status.models.some((model) => model.installed);
  const statusLabel = status === undefined ? "Checking…" : status === null ? "Desktop app required"
    : !status.supported ? "Unavailable" : job ? `Downloading…${queued.length ? ` ${queued.length} waiting` : ""}` : ready ? "Ready" : "No models installed";
  const hasLocal = !!status?.models.some((model) => model.local);
  useEffect(() => {
    if (!hasLocal) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [hasLocal, refresh]);

  async function pickLocal(mode: "file" | "folder" | "locate", id?: string) {
    setPicking(true);
    try {
      const reply = await desktopSd()!.pickLocal(mode, id);
      if ("error" in reply) toast.add({ title: reply.error, type: "error" });
      else if (reply.result) setLocal({ files: reply.result, replacing: id });
    } catch { toast.add({ title: "Could not open the checkpoint picker.", type: "error" }); }
    finally { setPicking(false); }
  }

  async function start(request: SdDownloadRequest) {
    if (!await download(request)) toast.add({ title: "Could not start the download.", type: "error" });
  }

  async function changeProfile(id: string, profileId: string) {
    setSavingProfileId(id);
    try {
      await setProfile(id, profileId);
    } catch (error) {
      toast.add({ title: error instanceof Error ? error.message : "Could not update the model profile", type: "error" });
    } finally {
      setSavingProfileId((current) => current === id ? null : current);
    }
  }

  return <section aria-labelledby="sd-heading" className="flex flex-col gap-3">
    {local && status && <SdLocalDialog {...local} status={status} onClose={() => setLocal(undefined)} />}
    <ConfirmDelete open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={removing?.local ? "Remove from Lomra?" : removing?.partial ? "Delete unfinished download?" : "Remove image model?"}
      actionLabel={removing?.local ? "Remove from Lomra" : undefined}
      description={removing?.local ? `The checkpoint for “${removing.name}” will stay on this computer.` : removing?.partial ? `The ${localModelSize(removing.partial)} downloaded so far of “${removing.name}” will be deleted from this computer.` : `“${removing?.name}” will be deleted from this computer. You can download it again later.`}
      onConfirm={async () => { if (removing) try { await remove(removing.id); } catch (error) { toast.add({ title: error instanceof Error ? error.message : "Could not remove the model", type: "error" }); } }} />

    <Dialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Download {confirming?.local ? "the image engine" : confirming?.name}?</DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            {confirming && <>
              <span>{confirming.note}</span>
              <span className="text-xs">{[!status?.engine && `+${localModelSize(status?.engineBytes ?? 0)} image engine`, job && "Starts after the other downloads"].filter(Boolean).join(" · ")}</span>
            </>}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirming(null)}>Not now</Button>
          <Button autoFocus onClick={() => { const model = confirming; setConfirming(null); if (model) void start(model.id); }}>Download {confirming && localModelSize(confirming.local ? status?.engineBytes ?? 0 : confirming.bytes)}</Button>
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
      {models.map((model) => {
        const compatible = model.custom ? (model.compatibleProfiles ?? [])
          .map((id) => status.profiles.find((profile) => profile.id === id))
          .filter((profile): profile is NonNullable<typeof profile> => !!profile) : [];
        return <li key={model.id}>
          <LocalModelRow name={model.name}
            description={[compatible.length ? undefined : model.quality, model.inpaint && "Inpainting", model.custom && model.note].filter(Boolean).join(" · ")}
            size={localModelSize(model.bytes)}
            status={model.localState === "missing" ? "File missing" : model.localState === "changed" ? "Checkpoint changed" : model.local && !status.engine ? "Image engine required" : model.installed ? "Installed" : model.partial ? `Paused, ${localModelSize(model.partial)} downloaded` : undefined}
            control={compatible.length ? <Select value={model.profile.id} disabled={savingProfileId === model.id}
              onValueChange={(value) => { if (value && value !== model.profile.id) void changeProfile(model.id, value); }}>
              <SelectTrigger size="sm" aria-label={`Profile for ${model.name}`} className="max-w-44 text-xs">
                <SelectValue className="truncate">{model.profile.name}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false} className="w-auto min-w-64 max-w-[calc(100vw-2rem)]">
                {compatible.map((profile) => <SelectItem key={profile.id} value={profile.id}>
                  <span className="truncate">{profile.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{profile.note}</span>
                </SelectItem>)}
              </SelectContent>
            </Select> : undefined}
            secondary={model.local && (!model.installed || !status.engine)
              ? { label: "Remove from Lomra", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) }
              : model.partial
              ? { label: "Delete unfinished download", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) } : undefined}
            action={model.local && model.localState !== "ready" ? { label: "Locate…", icon: <FolderOpenIcon aria-hidden="true" />, disabled: picking, onClick: () => void pickLocal("locate", model.id) }
              : model.local && !status.engine ? { label: "Download image engine", icon: <DownloadIcon aria-hidden="true" />, onClick: () => setConfirming(model) }
              : model.installed ? { label: model.local ? "Remove from Lomra" : "Remove", icon: <Trash2Icon aria-hidden="true" />, onClick: () => setRemoving(model) }
              // The user agreed to this download before; ask again only if it now includes the engine.
              : model.partial ? { label: "Resume download", icon: <PlayIcon aria-hidden="true" />, onClick: () => status.engine ? void start(model.id) : setConfirming(model) }
              : { label: "Download", icon: <DownloadIcon aria-hidden="true" />, onClick: () => setConfirming(model) }} />
        </li>;
      })}
    </ul>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={picking} onClick={() => void pickLocal("file")}>Add a file from this computer</Button>
      <Button variant="outline" disabled={picking} onClick={() => void pickLocal("folder")}>Scan a model folder</Button>
    </div>
    <SdHuggingFace status={status} onDownload={start} initialQuery={search} />
    </>}
  </section>;
}
