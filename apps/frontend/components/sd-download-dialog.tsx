"use client";

import { useEffect, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { localModelSize } from "@/components/ollama-settings";
import { defaultSdFile, sdVersions, type SdFile } from "@/components/sd-versions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { loadSdFiles } from "@/hooks/use-sd-files";
import { desktopSd, type SdDownloadRequest, type SdInspection, type SdStatus } from "@/lib/desktop";

export type SdRepo = { id: string; license?: string; file?: string };
type Inspected = SdInspection | { error: string };

/** Chooses and confirms one file of a Hugging Face repository. What it is comes from the file's own header, not from the user. */
export function SdDownloadDialog({ repo, status, onClose, onDownload }: {
  repo: SdRepo;
  status: SdStatus;
  onClose: () => void;
  onDownload: (request: SdDownloadRequest) => void;
}) {
  const [files, setFiles] = useState<SdFile[]>();
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [inspected, setInspected] = useState<Record<string, Inspected>>({});
  const [fewSteps, setFewSteps] = useState<Record<string, boolean>>({});
  // Only used when the header could not be read.
  const [family, setFamily] = useState(status.profiles[0]?.id ?? "");
  const file = files?.find((item) => item.file === chosen) ?? files?.find((item) => item.file === repo.file) ?? (files && defaultSdFile(files, status.gpuBytes));
  const name = file?.file;
  const kind = name ? inspected[name] : undefined;
  const supported = kind && "known" in kind && kind.known && kind.supported ? kind : undefined;
  const fewStep = (name ? fewSteps[name] : undefined) ?? supported?.fewStep ?? false;
  const builtIn = !!file && status.models.some((model) => model.id === file.id && !model.custom);

  useEffect(() => {
    let active = true;
    void loadSdFiles(repo.id).then((reply) => {
      if (!active) return;
      if ("error" in reply) setError(reply.error);
      else setFiles(reply.result);
    });
    return () => { active = false; };
  }, [repo.id]);

  useEffect(() => {
    if (!name) return;
    let active = true;
    void (async () => {
      let next: Inspected;
      try {
        const reply = await desktopSd()!.inspect(repo.id, name);
        next = "error" in reply ? reply : reply.result;
      } catch { next = { known: false }; }
      if (active) setInspected((all) => ({ ...all, [name]: next }));
    })();
    return () => { active = false; };
  }, [repo.id, name]);

  /** What the model list already says about a file, so it is not added twice. */
  const model = file && status.models.find((item) => item.id === file.id);
  const state = !file ? undefined : status.downloading?.id === file.id ? "Downloading"
    : status.queued.some((item) => item.id === file.id) ? "Waiting" : model?.installed ? "Installed" : model?.partial ? "Paused" : undefined;
  const problem = error || (files && !files.length ? "This model has no single-file checkpoint." : kind && "error" in kind ? kind.error
    : kind && "known" in kind && kind.known && !kind.supported ? "Lomra can’t run this file. It needs a Stable Diffusion 1.x, 2.x or SDXL checkpoint." : "");
  const license = repo.license === "other" ? undefined : repo.license;
  const unknown = !!kind && "known" in kind && !kind.known;
  const versions = sdVersions(repo.id, files ?? []);
  const note = [!status.engine && `+${localModelSize(status.engineBytes)} image engine`, status.downloading && "Starts after the other downloads"].filter(Boolean).join(" · ");

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} className="gap-5">
      <DialogHeader className="gap-2.5">
        <DialogTitle className="break-words">{files?.length ? versions.title : repo.id}</DialogTitle>
        <DialogDescription className="sr-only">Choose a version and download it from Hugging Face.</DialogDescription>
        <div className="flex min-h-5 flex-wrap items-center gap-1.5" aria-live="polite">
          {!problem && (!kind ? <><Skeleton className="h-5 w-16 rounded-full" /><span className="sr-only">Checking the model…</span></> : supported && <>
            <Badge variant="secondary">{supported.label}</Badge>
            {supported.inpaint && <Badge variant="secondary">Inpainting</Badge>}
          </>)}
          <Badge variant="outline" className="max-w-full" render={<a href={`https://huggingface.co/${repo.id}`} target="_blank" rel="noreferrer" aria-label={`${license ? `License: ${license}` : "View license"} (opens Hugging Face)`} />}>
            <span className="truncate">{license ?? "View license"}</span><ArrowUpRightIcon aria-hidden="true" />
          </Badge>
        </div>
      </DialogHeader>

      {files && files.length > 1 && <Field>
        <FieldLabel htmlFor="sd-version">Version</FieldLabel>
        <Select value={name ?? null} onValueChange={(value) => { if (value) setChosen(value); }}>
          <SelectTrigger id="sd-version" className="h-11 w-full"><SelectValue>{file && <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="truncate">{versions.label(file.file)}</span><span className="shrink-0 tabular-nums text-muted-foreground">{localModelSize(file.bytes)}</span>
          </span>}</SelectValue></SelectTrigger>
          <SelectContent>{files.map((item) => <SelectItem key={item.file} value={item.file}>
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3"><span className="break-all">{versions.label(item.file)}</span><span className="shrink-0 tabular-nums text-muted-foreground">{localModelSize(item.bytes)}</span></span>
          </SelectItem>)}</SelectContent>
        </Select>
      </Field>}

      {!problem && unknown && !builtIn && <Field>
        <FieldLabel htmlFor="sd-family">Model type</FieldLabel>
        <Select value={family} onValueChange={(value) => { if (value) setFamily(value); }}>
          <SelectTrigger id="sd-family" className="h-11 w-full"><SelectValue>{status.profiles.find((item) => item.id === family)?.name}</SelectValue></SelectTrigger>
          <SelectContent>{status.profiles.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>}
      {!problem && supported && !builtIn && <div className="flex items-center justify-between gap-4">
        <label htmlFor="sd-few-step">Few-step model <span className="text-xs text-muted-foreground">Turbo, Lightning, LCM</span></label>
        <Switch id="sd-few-step" checked={fewStep} onCheckedChange={(checked) => { if (name) setFewSteps((all) => ({ ...all, [name]: checked })); }} />
      </div>}
      {problem && <p role="alert" className="text-destructive">{problem}</p>}

      <DialogFooter className="items-center">
        {!problem && note && <p className="mr-auto text-xs text-muted-foreground">{note}</p>}
        <Button variant="outline" autoFocus onClick={onClose}>{problem && !(files && files.length > 1) ? "Close" : "Not now"}</Button>
        {!(problem && !(files && files.length > 1)) && <Button disabled={!file || !kind || !!problem || !!state} onClick={() => {
          if (!file) return;
          onDownload({ repo: repo.id, file: file.file, family: supported ? fewStep ? supported.fewStepFamily : supported.family : family });
          onClose();
        }}>{state ?? `Download${file ? ` ${localModelSize(file.bytes)}` : ""}`}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
