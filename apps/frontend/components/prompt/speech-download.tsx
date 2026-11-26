"use client";

import { useCallback, useRef, useState } from "react";
import { DownloadDialog } from "@/components/ui/download-dialog";
import { desktopSpeech, type SpeechModel } from "@/lib/desktop";

export const speechSize = (bytes: number) => bytes <= 0 ? "Size unavailable" : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

type Request = (started: boolean) => void;

/**
 * Asks in an app modal before a speech model is downloaded. `ask(id)` resolves true once the
 * download has started and false if the user declines; render `dialog` once in the component.
 */
export function useSpeechDownload() {
  const request = useRef<Request | null>(null);
  const [model, setModel] = useState<SpeechModel | null>(null);

  const ask = useCallback(async (id?: string | null) => {
    const bridge = desktopSpeech();
    const catalog = await bridge?.models();
    const found = catalog?.models.find((candidate) => id ? candidate.id === id : candidate.recommended);
    if (!found) throw new Error("Speech model unavailable.");
    if (request.current) throw new Error("A speech model download confirmation is already open.");
    return new Promise<boolean>((resolve) => {
      request.current = resolve;
      setModel(found);
    });
  }, []);

  function close(started: boolean) {
    request.current?.(started);
    request.current = null;
    setModel(null);
  }

  const dialog = model && <DownloadDialog
    title={`Download ${model.name} for voice input?`}
    description={`Download size: ${speechSize(model.bytes)}. Voice input transcribes on this computer. Your audio never leaves your device.`}
    onClose={close}
    onDownload={async () => {
      if (!await desktopSpeech()?.downloadModel(model.id)) throw new Error("Could not start the speech model download.");
    }}
  />;

  return { ask, dialog };
}
