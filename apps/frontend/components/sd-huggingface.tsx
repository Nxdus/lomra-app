"use client";

import { useState } from "react";
import { ArrowLeftIcon, DownloadIcon, LoaderCircleIcon, SearchIcon } from "lucide-react";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { localModelSize } from "@/components/ollama-settings";
import { desktopSd, type SdDownloadRequest, type SdFamily } from "@/lib/desktop";

type Found = { id: string; downloads: number };
type Checkpoint = { file: string; bytes: number };

const rowClass = "flex items-center gap-3 py-2.5 text-sm";

/** The checkpoint type a file name most likely is; the user can change it before downloading. */
export const guessFamily = (file: string) => /turbo|lightning|lcm|hyper/i.test(file) ? "turbo" : /xl/i.test(file) ? "sdxl" : "sd15";

const downloads = (count: number) => count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}K` : String(count);

/** Settings → Local models → Image models: find any single-file Stable Diffusion checkpoint on Hugging Face and download it. */
export function SdHuggingFace({ families, busy, onDownload }: { families: SdFamily[]; busy: boolean; onDownload: (request: SdDownloadRequest) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<Found[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<Checkpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Checkpoint | null>(null);
  const [family, setFamily] = useState("sd15");

  async function open(next: string, preferred?: string) {
    const api = desktopSd();
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const reply = await api.files(next);
      if ("error" in reply) { setError(reply.error); return; }
      setRepo(next);
      setFound(null);
      setFiles(reply.result);
      const match = preferred ? reply.result.find((item) => item.file === preferred) : undefined;
      if (match) { setFamily(guessFamily(match.file)); setPicked(match); }
    } catch {
      setError("Restart Lomra to use this, then try again.");
    } finally { setLoading(false); }
  }

  async function submit() {
    const text = query.trim();
    const api = desktopSd();
    if (!text || !api || loading) return;
    setLoading(true);
    setError(null);
    setRepo(null);
    setFiles(null);
    try {
      const reply = await api.search(text);
      if ("error" in reply) { setError(reply.error); setFound(null); return; }
      if (reply.result.repo) { setLoading(false); await open(reply.result.repo, reply.result.file); return; }
      setFound(reply.result.models);
    } catch {
      setError("Restart Lomra to use this, then try again.");
    } finally { setLoading(false); }
  }

  const back = () => { setRepo(null); setFiles(null); setError(null); };

  return <section aria-label="Add a model from Hugging Face" className="flex flex-col gap-1.5">
    <Dialog open={!!picked} onOpenChange={(open) => { if (!open) setPicked(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Download {picked?.file}?</DialogTitle>
          <DialogDescription>
            {picked && `${localModelSize(picked.bytes)} from huggingface.co/${repo}. Its size and checksum are verified against Hugging Face. Check the model’s license on its page before using the images; Lomra cannot check it.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sd-family" className="text-xs font-medium text-muted-foreground">What kind of model is it?</label>
          <Select value={family} onValueChange={(value) => { if (value) setFamily(value); }}>
            <SelectTrigger id="sd-family" className="w-full"><SelectValue>{families.find((item) => item.id === family)?.name ?? "Choose"}</SelectValue></SelectTrigger>
            <SelectContent>
              {families.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.note}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">This sets the picture size and number of steps. Pick the wrong one and images may look broken.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPicked(null)}>Not now</Button>
          <Button autoFocus onClick={() => { const file = picked; setPicked(null); if (file && repo) void onDownload({ repo, file: file.file, family }).catch(() => toast.add({ title: "Could not start the download.", type: "error" })); }}>Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <h3 className="text-xs font-medium text-muted-foreground">Add from Hugging Face</h3>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <InputGroup className="h-10 rounded-lg">
        <InputGroupInput aria-label="Search Hugging Face or paste a model link" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models or paste a link" autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" size="icon-sm" aria-label="Search" disabled={busy || loading || !query.trim()}>
            {loading ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <SearchIcon aria-hidden="true" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

    {found && (found.length
      ? <ul className="divide-y" aria-label="Search results">
        {found.map((item) => <li key={item.id}>
          <Button type="button" variant="ghost" className="h-auto w-full justify-start gap-3 py-2.5 text-left" onClick={() => void open(item.id)}>
            <span className="min-w-0 flex-1 truncate" title={item.id}>{item.id}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{downloads(item.downloads)} downloads</span>
          </Button>
        </li>)}
      </ul>
      : <p role="status" className="text-xs text-muted-foreground">No text-to-image models found.</p>)}

    {repo && files && <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Tip label="Back"><Button type="button" variant="ghost" size="icon-xs" aria-label="Back to results" onClick={back}><ArrowLeftIcon aria-hidden="true" /></Button></Tip>
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={repo}>{repo}</span>
      </div>
      {files.length
        ? <ul className="divide-y" aria-label={`Files in ${repo}`}>
          {files.map((item) => <li key={item.file} className={rowClass}>
            <div className="min-w-0 flex-1">
              <div className="truncate" title={item.file}>{item.file}</div>
              <div className="text-xs text-muted-foreground">{localModelSize(item.bytes)}</div>
            </div>
            <Tip label="Download"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Download ${item.file}`} disabled={busy} onClick={() => { setFamily(guessFamily(item.file)); setPicked(item); }}><DownloadIcon aria-hidden="true" /></Button></Tip>
          </li>)}
        </ul>
        : <p role="status" className="text-xs text-muted-foreground">No single-file .safetensors or .gguf checkpoint at the top of this repository. Models split into folders are not supported.</p>}
    </div>}
  </section>;
}
