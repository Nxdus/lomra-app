"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { characterImageType, characterNameKey, characterNameLimit, characterNamePattern, characterNotesLimit, type Character } from "@/lib/characters";
import { storage, storageFile } from "@/lib/storage";
import { MAX_MEDIA_BYTES } from "./prompt/media";

export function CharacterDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [id] = useState(() => `character-${crypto.randomUUID()}`);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const alias = name.trim().normalize("NFC");
    if (alias.length > characterNameLimit || !characterNamePattern.test(alias)) {
      setError("Use letters, numbers, hyphens, or underscores, with no spaces.");
      return;
    }
    if (!file.size || file.size > MAX_MEDIA_BYTES || !characterImageType.test(file.type)) {
      setError("Choose a PNG, JPEG, WebP, or GIF under 20 MB.");
      return;
    }
    setError("");
    pending.current = true;
    setSaving(true);
    try {
      const rows: { value: Character }[] = await storage("characters");
      if (rows.some(({ value }) => value.id !== id && characterNameKey(value.name) === characterNameKey(alias))) {
        setError(`@${alias} is already in use. Choose another name.`);
        return;
      }
      // Keep the reference available even when its original canvas is deleted.
      await storageFile(id, file);
      await storage(`characters/${id}`, "PUT", { id, name: alias, notes: notes.trim(), imageType: file.type } satisfies Character);
      toast.add({ title: `Character saved as @${alias}`, type: "success" });
      onClose();
    } catch {
      setError("Could not save the Character. Please try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose(); }}>
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Save as Character</DialogTitle>
          <DialogDescription>Use @{name.trim() || "name"} in any chat in this workspace to reference this image.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="character-name">Name</FieldLabel>
              <Input id="character-name" required maxLength={characterNameLimit} disabled={saving} value={name} onChange={(event) => setName(event.target.value)} />
              <FieldDescription>Use a name without spaces, such as Rain-Scout.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="character-notes">Appearance notes (optional)</FieldLabel>
              <Textarea id="character-notes" rows={2} maxLength={characterNotesLimit} disabled={saving} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Character"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
