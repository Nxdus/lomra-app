"use client";

import { useRef, useState } from "react";
import { DownloadIcon, ExternalLinkIcon, LoaderCircleIcon, PauseIcon, PlayIcon, PowerOffIcon, RefreshCwIcon, SaveIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { Tip } from "@/components/tip";
import { LocalModelRow } from "@/components/local-model-row";
import { OllamaIcon } from "@/components/ollama-icon";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { DownloadDialog } from "@/components/ui/download-dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ollamaStore, useOllama } from "@/hooks/use-ollama";
import { useOllamaLibrary, useOllamaModelDetails } from "@/hooks/use-ollama-library";
import { defaultOllamaUrl } from "@/lib/ollama-url";

// Free models that can call tools, which Lomra needs to turn a chat into generations.
export const recommendedLocalModels = [
  { id: "qwen3:4b", name: "Qwen 3 4B", note: "Fast, good for most computers", size: "≈2.5 GB" },
  { id: "llama3.2:3b", name: "Llama 3.2 3B", note: "Smallest, runs on modest hardware", size: "≈2 GB" },
  { id: "qwen3:8b", name: "Qwen 3 8B", note: "Smarter, needs 8 GB+ of memory", size: "≈5 GB" },
  { id: "qwen3-vl:4b", name: "Qwen 3 VL 4B", note: "Also reads selected images", size: "≈3 GB" },
];

export const localModelSize = (bytes: number) => bytes <= 0 ? "Size unavailable" : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
const sameModel = (a: string, b: string) => a === b || a === `${b}:latest` || b === `${a}:latest`;

function OllamaDownload({ model, onClose, onDownload }: { model: string; onClose: () => void; onDownload: () => Promise<void> }) {
  const [family, tag = "latest"] = model.split(":");
  const { details, rowRef } = useOllamaModelDetails(family);
  const recommended = recommendedLocalModels.find(({ id }) => id === model);
  return <DownloadDialog title={`Download ${model}?`} description={<span ref={rowRef}>
    {details?.sizes[`${family}:${tag}`] ?? recommended?.size ?? "Size unavailable"}
  </span>} onClose={onClose} onDownload={onDownload} />;
}

function LibraryModelOption({ id }: { id: string }) {
  const [family, tag = "latest"] = id.split(":");
  const { details, rowRef } = useOllamaModelDetails(family);
  const recommended = recommendedLocalModels.find((model) => model.id === id);
  const size = details?.sizes[`${family}:${tag}`] ?? recommended?.size;
  const description = details?.description || recommended?.note;

  return <ComboboxItem value={id} className="group/ollama-option pr-3">
    <div ref={rowRef} className="min-w-0 flex-1 space-y-1">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="truncate font-medium">{id}</span>
        {(size || details !== undefined) && (
          <Badge variant="outline" className="tabular-nums">
            {size ?? "Size unavailable"}
          </Badge>
        )}
      </div>
      <div title={description} className="line-clamp-2 min-h-4 text-xs/4 text-foreground/65 group-data-highlighted/ollama-option:opacity-70">
        {description ?? (details === undefined ? "" : "Description unavailable")}
      </div>
    </div>
  </ComboboxItem>;
}

export function OllamaSettings() {
  const { running, models, pull, canStart, installMethod, installing, installCli, canUninstall, uninstalling, uninstallCli, starting, start, refresh, install, cancel, remove, url, remote, setServer } = useOllama();
  const [editing, setEditing] = useState(false);
  const [confirmingInstall, setConfirmingInstall] = useState(false);
  const showInstallConfirmation = confirmingInstall && running === false && !canStart && installMethod === "winget";
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const address = addressDraft ?? (url === defaultOllamaUrl ? "" : url);
  const [confirmingModel, setConfirmingModel] = useState<{ id: string; custom?: boolean } | null>(null);
  const [custom, setCustom] = useState("");
  // The suggestions are as wide as the whole search bar, not just its text field.
  const searchBar = useRef<HTMLFormElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const busy = !!pull;

  function download(model: string, fromSearch?: boolean) {
    return new Promise<void>((resolve, reject) => {
      let acknowledged = false;
      const unsubscribe = ollamaStore.subscribe(() => {
        const active = ollamaStore.snapshot().pull;
        if (active?.model === model && active.status !== "Starting…") {
          acknowledged = true;
          unsubscribe();
          resolve();
        }
      });
      void install(model).then(() => {
        if (fromSearch) setCustom((current) => current.trim() === model ? "" : current);
        toast.add({ title: `${model} installed`, type: "success" });
        resolve();
      }, (error: unknown) => {
        const title = error instanceof Error ? error.message : "Could not install the model";
        if (title.startsWith("Download stopped.")) {
          toast.add({ title: "Download paused", description: "Choose Download again to resume." });
          resolve();
        }
        else if (acknowledged) toast.add({ title, type: "error" });
        else reject(error);
      }).finally(unsubscribe);
    });
  }

  async function installOllama() {
    const failed = "Ollama could not be installed. Try the download page at ollama.com.";
    const result = await installCli().catch(() => { throw new Error(failed); });
    if (result === "installed") toast.add({ title: "Ollama installed", type: "success" });
    else if (result === "manual") toast.add({ title: "Opened the Ollama download page. Install it, then choose Check again." });
    else throw new Error(failed);
  }

  async function uninstallOllama() {
    const failed = "Ollama could not be uninstalled. Remove it in Windows Settings → Installed apps.";
    const result = await uninstallCli().catch((error: unknown) => {
      throw new Error(error instanceof Error && /handler|not a function/i.test(error.message) ? "Restart Lomra to use this, then try again." : failed);
    });
    if (result !== "uninstalled") throw new Error(failed);
    toast.add({ title: "Ollama uninstalled", type: "success" });
  }

  async function saveAddress() {
    setSavingAddress(true);
    try {
      await setServer(address);
      setAddressDraft(null);
      setEditing(false);
      toast.add({ title: address.trim() ? "Ollama server saved" : "Using Ollama on this computer", type: "success" });
    } catch (error) {
      toast.add({ title: error instanceof Error ? error.message : "Could not save the address", type: "error" });
    } finally { setSavingAddress(false); }
  }

  const status = running === null ? "Checking…" : running ? "Running"
    : canStart ? "Not running" : installMethod ? "Not installed" : remote ? "Can’t reach server" : "Not running";
  const library = useOllamaLibrary();
  const suggestions = library.filter((id) => !models.some((item) => sameModel(item.id, id)));
  const recommended = recommendedLocalModels.filter((model) => !models.some((item) => sameModel(item.id, model.id)) && model.id !== pull?.model);

  return <section aria-labelledby="ollama-heading" className="flex flex-col gap-4">
    <ConfirmDelete open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title="Remove local model?" actionLabel="Remove"
      description={`“${removing}” will be deleted from this computer. You can download it again later.`}
      onConfirm={async () => { if (removing) await remove(removing); }} />

    <ConfirmDelete open={confirmingUninstall} onOpenChange={setConfirmingUninstall}
      title="Uninstall Ollama?" actionLabel="Uninstall" pendingLabel="Uninstalling…"
      description={models.length ? `Ollama and your ${models.length === 1 ? "downloaded model" : `${models.length} downloaded models`}${models.some((model) => model.size > 0) ? ` (${localModelSize(models.reduce((sum, model) => sum + model.size, 0))})` : ""} will be deleted from this computer. You can install them again later.` : "Ollama will be stopped and removed from this computer."} onConfirm={uninstallOllama} />
    {confirmingModel && <OllamaDownload model={confirmingModel.id} onClose={() => setConfirmingModel(null)}
      onDownload={() => download(confirmingModel.id, confirmingModel.custom)} />}

    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <OllamaIcon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 id="ollama-heading" className="text-sm font-semibold">Ollama</h2>
            <p className="text-xs text-muted-foreground">Local chat models</p>
          </div>
          <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${running ? "bg-primary" : "bg-muted-foreground/40"}`} />
            <span>{status}</span>
            {remote && <span className="min-w-0 truncate" title={url}>· {url}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {running === false && (canStart
            ? <Tip label={starting ? "Starting…" : "Start Ollama"}><Button type="button" size="icon-sm" disabled={starting} aria-label={starting ? "Starting Ollama" : "Start Ollama"} onClick={() => void start().then((started) => { if (!started) toast.add({ title: "Ollama did not start. Try opening it yourself.", type: "error" }); })}>
              {starting ? <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" /> : <PlayIcon aria-hidden="true" />}
            </Button></Tip>
            : installMethod
              ? <Tip label={installing ? "Installing…" : installMethod === "winget" ? "Install Ollama" : "Download Ollama"}><Button type="button" variant="ghost" size="icon-sm" disabled={installing} aria-label={installing ? "Installing Ollama" : installMethod === "winget" ? "Install Ollama" : "Download Ollama"} aria-expanded={installMethod === "winget" ? showInstallConfirmation : undefined} onClick={() => installMethod === "winget" ? setConfirmingInstall(true) : void installOllama().catch((error: Error) => toast.add({ title: error.message, type: "error" }))}>
                {installing ? <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" /> : installMethod === "winget" ? <DownloadIcon aria-hidden="true" /> : <ExternalLinkIcon aria-hidden="true" />}
              </Button></Tip>
              : <Tip label="Check again"><Button type="button" variant="outline" size="icon-sm" aria-label="Check again" onClick={() => void refresh()}><RefreshCwIcon aria-hidden="true" /></Button></Tip>)}
          {canUninstall && <Tip label={uninstalling ? "Uninstalling…" : "Uninstall Ollama"}><Button type="button" variant="ghost" size="icon-sm" aria-label="Uninstall Ollama" disabled={busy || uninstalling || starting} onClick={() => setConfirmingUninstall(true)}>
            {uninstalling ? <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" /> : <PowerOffIcon aria-hidden="true" />}
          </Button></Tip>}
          <Tip label="Change server"><Button type="button" variant="ghost" size="icon-sm" aria-label="Change Ollama server" aria-pressed={editing} disabled={busy} onClick={() => setEditing((value) => !value)}><SlidersHorizontalIcon aria-hidden="true" /></Button></Tip>
        </div>
      </div>
      {showInstallConfirmation && <DownloadDialog title="Download Ollama?"
        description="Size unavailable. Lomra installs Ollama with the Windows package manager. Windows may ask for permission."
        onClose={() => setConfirmingInstall(false)} onDownload={installOllama} />}
      {(installing || uninstalling) && <div className="flex flex-col gap-1.5">
        <Progress value={null} aria-label={uninstalling ? "Uninstalling Ollama" : "Installing Ollama"} />
        <p className="text-xs text-muted-foreground">{uninstalling ? "Uninstalling Ollama…" : "Installing Ollama. This can take a few minutes, and you can keep using Lomra."}</p>
      </div>}
      {editing && <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void saveAddress(); }}>
        <InputGroup className="h-10 rounded-lg">
          <InputGroupInput id="ollama-address" aria-label="Ollama server address" value={address} onChange={(event) => setAddressDraft(event.target.value)}
            placeholder={`This computer (${defaultOllamaUrl})`} autoComplete="off" spellCheck={false} maxLength={200} disabled={savingAddress} />
        </InputGroup>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={savingAddress || addressDraft === null}><SaveIcon aria-hidden="true" data-icon="inline-start" />{savingAddress ? "Saving…" : "Save"}</Button>
        </div>
      </form>}
    </div>

    {running === null ? <div role="status" aria-label="Checking Ollama" aria-busy="true" className="flex flex-col gap-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
    : running && <>
      <section aria-label="Installed models" className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Installed</h3>
        <ul className="divide-y">
          {pull && <li className="pb-2">
            <LocalModelRow name={pull.model} size={pull.percent === null ? "" : `${pull.percent}%`}
              description={pull.total > 0 ? `${localModelSize(pull.completed)} of ${localModelSize(pull.total)}` : ""}
              status={pull.status}
              action={{ label: "Pause download", icon: <PauseIcon aria-hidden="true" />, onClick: cancel }} />
            <Progress value={pull.percent} aria-label={`Downloading ${pull.model}`} />
          </li>}
          {models.map((model) => <li key={model.id}>
            <LocalModelRow name={model.id} size={model.size > 0 ? localModelSize(model.size) : ""}
              description={[model.tools ? "Tools" : "No tools · can’t be used in chat", model.vision && "Vision"].filter(Boolean).join(" · ")}
              action={{ label: "Remove", icon: <Trash2Icon aria-hidden="true" />, disabled: busy, onClick: () => setRemoving(model.id) }} />
          </li>)}
          {!pull && !models.length && <li className="text-xs text-muted-foreground">No models installed yet.</li>}
        </ul>
      </section>

      <section aria-label="Download a model" className="flex flex-col gap-3">
        {recommended.length > 0 && <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Recommended</h3>
          <ul className="divide-y">
            {recommended.map((model) => <li key={model.id}>
              <LocalModelRow name={model.name} description={model.note} size={model.size}
                action={{ label: "Download", icon: <DownloadIcon aria-hidden="true" />, disabled: busy, onClick: () => setConfirmingModel({ id: model.id }) }} />
            </li>)}
          </ul>
        </div>}
        <form ref={searchBar} onSubmit={(event) => { event.preventDefault(); const name = custom.trim(); if (name && !busy) setConfirmingModel({ id: name, custom: true }); }}>
          <Combobox items={suggestions} value={null} inputValue={custom} onInputValueChange={setCustom} onValueChange={(value) => { if (typeof value === "string") setCustom(value); }} disabled={busy}>
            <ComboboxInput className="h-11" showTrigger={false} placeholder="Search or enter an Ollama model" aria-label="Ollama model to download" autoComplete="off" spellCheck={false} maxLength={128} disabled={busy}>
              <InputGroupAddon align="inline-end">
                <Tip label="Download model"><InputGroupButton type="submit" size="icon-sm" aria-label="Download model" disabled={busy || !custom.trim()}><DownloadIcon aria-hidden="true" /></InputGroupButton></Tip>
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxContent anchor={searchBar} side="top">
              <ComboboxEmpty>Not in the list. Press Enter to try this name.</ComboboxEmpty>
              <ComboboxList className="space-y-0.5">{(item: string) => <LibraryModelOption key={item} id={item} />}</ComboboxList>
            </ComboboxContent>
          </Combobox>
        </form>
      </section>
    </>}
  </section>;
}
