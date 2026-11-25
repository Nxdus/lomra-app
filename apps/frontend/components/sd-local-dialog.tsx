import { useRef, useState } from "react";
import { localModelSize } from "@/components/ollama-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { desktopSd, type SdLocalCandidate, type SdStatus } from "@/lib/desktop";

export function SdLocalDialog({ files, status, replacing, onClose }: {
  files: SdLocalCandidate[];
  status: SdStatus;
  replacing?: string;
  onClose: () => void;
}) {
  const [id, setId] = useState(files[0]?.id);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const file = files.find((item) => item.id === id);
  const currentProfile = status.models.find((model) => model.id === replacing)?.profile.id;
  const family = file && (overrides[file.id] ?? (currentProfile && file.compatibleProfiles.includes(currentProfile) ? currentProfile : file.suggestedProfile));
  const title = replacing ? "Locate checkpoint" : "Add a checkpoint";
  const label = (item: SdLocalCandidate) => `${item.name} · ${item.label}${item.inpaint ? " · Inpainting" : ""} · ${localModelSize(item.bytes)}`;

  async function confirm() {
    if (!file || !family || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const reply = await desktopSd()!.addLocal(file.id, family, !status.engine);
      if ("error" in reply) setError(reply.error);
      else {
        window.dispatchEvent(new Event("sd-status-changed"));
        onClose();
      }
    } catch { setError("Could not add the checkpoint."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose(); }}>
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{file ? "Lomra uses the checkpoint in its current location." : "No supported Stable Diffusion checkpoints were found."}</DialogDescription>
      </DialogHeader>
      {file && (files.length === 1 ? <p className="break-all text-sm">{label(file)}</p> : <Field>
        <FieldLabel htmlFor="local-checkpoint">Checkpoint</FieldLabel>
        <Select value={file.id} disabled={busy} onValueChange={(value) => { if (value) { setId(value); setError(""); } }}>
          <SelectTrigger id="local-checkpoint" className="w-full"><SelectValue className="truncate">{label(file)}</SelectValue></SelectTrigger>
          <SelectContent>{files.map((entry) => <SelectItem key={entry.id} value={entry.id}><span className="break-all">{label(entry)}</span></SelectItem>)}</SelectContent>
        </Select>
      </Field>)}
      {file && <Field>
        <FieldLabel htmlFor="local-profile">Profile</FieldLabel>
        <Select key={file.id} value={family} disabled={busy} onValueChange={(value) => { if (value) setOverrides((current) => ({ ...current, [file.id]: value })); }}>
          <SelectTrigger id="local-profile" className="w-full"><SelectValue>{status.profiles.find((profile) => profile.id === family)?.name}</SelectValue></SelectTrigger>
          <SelectContent>{status.profiles.filter((profile) => file.compatibleProfiles.includes(profile.id)).map((profile) =>
            <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>{file ? "Cancel" : "Close"}</Button>
        {file && <Button disabled={busy} onClick={() => void confirm()}>{busy ? "Checking…" : !status.engine ? `Save and download engine (${localModelSize(status.engineBytes)})` : replacing ? "Use this file" : "Add to Lomra"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
