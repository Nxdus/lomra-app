"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ConfirmDelete({ open, onOpenChange, title, description, onConfirm, disabled = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!pending.current) onOpenChange(next); }}>
    <DialogContent showCloseButton={false}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button variant="outline" autoFocus disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="destructive" disabled={busy || disabled} onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          try { await onConfirm(); onOpenChange(false); }
          finally { pending.current = false; setBusy(false); }
        }}>{busy ? "Deleting…" : "Delete"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
