"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktopSpeech, type SpeechModel } from "@/lib/desktop";

export const speechSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

type Request = { resolve: (started: boolean) => void; reject: (cause: unknown) => void };

/**
 * Asks in an app modal before a speech model is downloaded. `ask(id)` resolves true once the
 * download has started and false if the user declines; render `dialog` once in the component.
 */
export function useSpeechDownload() {
  const request = useRef<Request | null>(null);
  const [model, setModel] = useState<SpeechModel | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(async (id?: string | null) => {
    const bridge = desktopSpeech();
    const catalog = await bridge?.models();
    const found = catalog?.models.find((candidate) => id ? candidate.id === id : candidate.recommended);
    if (!found) return false;
    request.current?.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      request.current = { resolve, reject };
      setModel(found);
      setOpen(true);
    });
  }, []);

  function close(started: boolean) {
    request.current?.resolve(started);
    request.current = null;
    setOpen(false);
  }

  async function confirm() {
    if (!model || busy) return;
    setBusy(true);
    try {
      close(Boolean(await desktopSpeech()?.downloadModel(model.id)));
    } catch (cause) {
      request.current?.reject(cause);
      request.current = null;
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const dialog = <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) close(false); }}>
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Download {model?.name} for voice input?</DialogTitle>
        <DialogDescription>
          Voice input transcribes on this computer. It needs a one-time download of about {model ? speechSize(model.bytes) : ""}. Your audio never leaves your device.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => close(false)}>Not now</Button>
        <Button autoFocus disabled={busy} onClick={() => void confirm()}>{busy ? "Starting…" : "Download"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  return { ask, dialog };
}
