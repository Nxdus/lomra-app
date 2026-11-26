"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { prepareStoryboardExport, storyboardZip } from "./storyboard-export-data";
import type { StoryboardDialogProps } from "./storyboard-preview";

export function StoryboardExport({ storyboard, images, open, onOpenChange }: StoryboardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export storyboard</DialogTitle>
          <DialogDescription>
            Edit the Markdown before downloading. The ZIP includes the Markdown and available pictures.
          </DialogDescription>
        </DialogHeader>
        {open && <ExportDraft storyboard={storyboard} images={images} />}
      </DialogContent>
    </Dialog>
  );
}

type Draft = Awaited<ReturnType<typeof prepareStoryboardExport>>;

function ExportDraft({ storyboard, images }: Pick<StoryboardDialogProps, "storyboard" | "images">) {
  const [draft, setDraft] = useState<Draft>();
  const [edited, setEdited] = useState<string>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void prepareStoryboardExport(storyboard, images, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setDraft(result); },
      () => { if (!controller.signal.aborted) setError("Could not prepare the storyboard export."); },
    );
    return () => controller.abort();
  }, [storyboard, images, attempt]);

  if (!draft) return error ? <div className="space-y-2">
    <p role="alert" className="text-destructive">{error}</p>
    <Button variant="outline" onClick={() => { setError(""); setAttempt((current) => current + 1); }}>Retry</Button>
  </div> : <p role="status" className="text-muted-foreground">Checking storyboard pictures…</p>;
  const markdown = edited ?? draft.markdown;

  function downloadZip(files: Draft["files"]) {
    try {
      download("storyboard.zip", new Blob([storyboardZip(markdown, files)], { type: "application/zip" }));
      setError("");
    } catch {
      setError("Could not create the ZIP. You can still download the Markdown.");
    }
  }

  return (
    <>
      {draft.missing.length > 0 && (
        <p role="status" className="text-muted-foreground">
          {draft.missing.length} {draft.missing.length === 1 ? "asset is" : "assets are"} missing. You can download the draft now.
          The Markdown lists the missing assets.
        </p>
      )}
      <Textarea aria-label="Storyboard Markdown" value={markdown} onChange={(event) => setEdited(event.target.value)}
        className="h-72 field-sizing-fixed resize-y font-mono" spellCheck={false} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => download("storyboard.md", new Blob([markdown], { type: "text/markdown;charset=utf-8" }))}>
          Export Markdown
        </Button>
        <Button type="button" onClick={() => downloadZip(draft.files)}>Export ZIP</Button>
      </DialogFooter>
    </>
  );
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
