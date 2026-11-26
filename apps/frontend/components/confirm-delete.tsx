"use client";

import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ConfirmDelete({ open, onOpenChange, title, description, onConfirm, disabled = false, actionLabel = "Delete", pendingLabel = actionLabel === "Delete" ? "Deleting…" : "Removing…" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  actionLabel?: string;
  pendingLabel?: string;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  function close() {
    setError("");
    onOpenChange(false);
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !pending.current) close(); }}>
    <DialogContent showCloseButton={false} initialFocus={cancelButton}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter>
        <Button variant="outline" ref={cancelButton} disabled={busy} onClick={close}>Cancel</Button>
        <Button variant="destructive" disabled={busy || disabled} onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try { await onConfirm(); close(); }
          catch (cause) { setError(cause instanceof Error ? cause.message || "Something went wrong. Try again." : "Something went wrong. Try again."); }
          finally { pending.current = false; setBusy(false); }
        }}>{busy ? pendingLabel : actionLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
