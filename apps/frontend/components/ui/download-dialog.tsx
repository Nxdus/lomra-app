"use client";

import { useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DownloadDialog({ title, description, onClose, onDownload }: {
  title: string;
  description: ReactNode;
  onClose: (started: boolean) => void;
  onDownload: () => Promise<void>;
}) {
  const dismiss = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onDownload();
      onClose(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the download.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose(false); }}>
    <DialogContent showCloseButton={false} initialFocus={dismiss}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter>
        <Button ref={dismiss} variant="outline" disabled={busy} onClick={() => onClose(false)}>Not now</Button>
        <Button disabled={busy} onClick={() => void confirm()}>{busy ? "Starting…" : "Download"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
