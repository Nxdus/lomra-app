"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { localModelSize } from "@/components/ollama-settings";
import { SdDownloadDialog, type SdRepo } from "@/components/sd-download-dialog";
import { Badge } from "@/components/ui/badge";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { useSdFiles } from "@/hooks/use-sd-files";
import { desktopSd, type SdDownloadRequest, type SdStatus } from "@/lib/desktop";

type Found = SdRepo & { downloads?: number };

/** Nothing is sent to Hugging Face before this many characters, or while the user is still typing. */
const minQuery = 3;
const typingPause = 400;

const count = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);

function RepoOption({ item }: { item: Found }) {
  const { files, rowRef } = useSdFiles(item.id);
  const sizes = files?.map((file) => file.bytes).sort((a, b) => a - b) ?? [];
  const [smallest, largest] = [sizes[0], sizes[sizes.length - 1]].map((bytes) => bytes === undefined ? "" : localModelSize(bytes));
  // "1.7–2.1 GB" rather than "1.7 GB–2.1 GB".
  const size = smallest === largest ? largest : `${smallest.endsWith(" GB") === largest.endsWith(" GB") ? smallest.slice(0, -3) : smallest}–${largest}`;
  const [owner, name] = item.id.split("/");
  return <ComboboxItem value={item.id} className="group/repo-option pr-3">
    <div ref={rowRef} className="min-w-0 flex-1 space-y-1">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="truncate font-medium" title={item.id}>{name}</span>
        {(size || files !== undefined) && <Badge variant="outline" className="tabular-nums">{size || "Size unavailable"}</Badge>}
      </div>
      <div className="min-h-4 truncate text-xs/4 text-foreground/65 group-data-highlighted/repo-option:opacity-70">
        {[owner, files?.length && `${files.length} ${files.length === 1 ? "version" : "versions"}`, item.downloads !== undefined && `${count(item.downloads)} downloads`].filter(Boolean).join(" · ")}
      </div>
    </div>
  </ComboboxItem>;
}

/** Settings → Local models → Stable Diffusion: find a checkpoint on Hugging Face and download it. Searches as the user types. */
export function SdHuggingFace({ status, onDownload, initialQuery = "" }: {
  status: SdStatus;
  onDownload: (request: SdDownloadRequest) => Promise<void>;
  /** Searched for right away, with the field focused. */
  initialQuery?: string;
}) {
  const searchBar = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(0);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<SdRepo | null>(null);

  async function search(text: string) {
    const run = ++latest.current;
    let models: Found[] = [];
    let problem = "";
    try {
      const reply = await desktopSd()!.search(text);
      if ("error" in reply) problem = reply.error;
      else models = reply.result.repo ? [{ id: reply.result.repo, file: reply.result.file }] : reply.result.models;
    } catch { problem = "Restart Lomra to use this, then try again."; }
    if (run !== latest.current) return;
    setFound(models);
    setError(problem);
    setLoading(false);
  }

  function change(text: string) {
    setQuery(text);
    clearTimeout(timer.current);
    latest.current++;
    setError("");
    const ready = text.trim().length >= minQuery;
    setLoading(ready);
    if (ready) timer.current = setTimeout(() => void search(text.trim()), typingPause);
    else setFound([]);
  }

  useEffect(() => {
    // After the dialog around it has moved focus to its first control.
    const start = initialQuery ? setTimeout(() => {
      input.current?.focus();
      input.current?.scrollIntoView({ block: "center" });
      setOpen(true);
      change(initialQuery);
    }, 300) : undefined;
    return () => { clearTimeout(start); clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, when the field appears
  }, []);

  const pick = (id: string) => { const item = found.find((entry) => entry.id === id); if (item) { setOpen(false); setPicked(item); } };
  const message = error || (query.trim().length < minQuery ? "Type at least 3 characters." : loading ? "Searching Hugging Face…" : "No usable models found.");

  return <section aria-label="Add a model from Hugging Face" className="flex flex-col gap-3">
    {picked && <SdDownloadDialog repo={picked} status={status} onClose={() => { setPicked(null); input.current?.focus(); }} onDownload={(request) => void onDownload(request)} />}
    <form ref={searchBar} onSubmit={(event) => { event.preventDefault(); if (!loading && found.length) pick(found[0].id); }}>
      <Combobox items={found.map((item) => item.id)} filter={null} value={null} open={open} onOpenChange={setOpen} inputValue={query}
        onInputValueChange={(text, { reason }) => { if (reason === "input-change") change(text); }}
        onValueChange={(value) => { if (typeof value === "string") pick(value); }}>
        <ComboboxInput ref={input} className="h-11" showTrigger={false} placeholder="Search Hugging Face or paste a link" aria-label="Hugging Face model to download" autoComplete="off" spellCheck={false} maxLength={1800}>
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" size="icon-sm" aria-label="Choose a version to download" disabled={loading || !found.length}><DownloadIcon aria-hidden="true" /></InputGroupButton>
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent anchor={searchBar} side="top">
          <ComboboxEmpty className="px-3">{message}</ComboboxEmpty>
          <ComboboxList className="space-y-0.5">{(id: string) => { const item = found.find((entry) => entry.id === id); return item && <RepoOption key={id} item={item} />; }}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </form>
  </section>;
}
