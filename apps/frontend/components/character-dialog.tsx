"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { characterImageId, characterImageLimit, characterImageType, characterNameKey, characterNameLimit, characterNamePattern, characterNotesLimit, type Character } from "@/lib/characters";
import type { CanvasImage } from "@/lib/image-canvas/image-canvas-storage";
import { storage, storageFile } from "@/lib/storage";
import { MAX_MEDIA_BYTES } from "./prompt/media";

export function CharacterDialog({ images, onClose }: { images: (CanvasImage & { url: string })[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [coverIndex, setCoverIndex] = useState(0);
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
    const files = images.map(({ file }) => file);
    if (files.length > characterImageLimit || files.reduce((size, file) => size + file.size, 0) > MAX_MEDIA_BYTES) {
      setError(`Choose up to ${characterImageLimit} images totaling at most 20 MB.`);
      return;
    }
    if (files.some(file => !file.size || !characterImageType.test(file.type))) {
      setError("Choose PNG, JPEG, WebP, or GIF images.");
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
      for (const [index, file] of files.entries()) await storageFile(characterImageId(id, index), file);
      const [imageType, ...additionalImageTypes] = files.map(file => file.type);
      await storage(`characters/${id}`, "PUT", {
        id, name: alias, notes: notes.trim(), imageType,
        ...(additionalImageTypes.length > 0 && { additionalImageTypes, coverIndex }),
      } satisfies Character);
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
          <DialogTitle>Save character</DialogTitle>
          <DialogDescription>Use @{name.trim() || "name"} in chat to reference {images.length === 1 ? "this image" : `these ${images.length} images`}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <FieldGroup>
            {images.length > 1 && images.length <= characterImageLimit && (
              <Field>
                <div role="group" aria-label="Cover image" className="grid grid-cols-5 gap-2">
                  <span className="col-span-5 text-sm font-medium">Cover image</span>
                  {images.map(({ id, url }, index) => (
                    <Button key={id} type="button" variant={index === coverIndex ? "default" : "outline"}
                      aria-label={`Image ${index + 1}`} aria-pressed={index === coverIndex} disabled={saving}
                      className="aspect-square h-auto overflow-hidden rounded-lg p-1" onClick={() => setCoverIndex(index)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="size-full rounded-sm object-cover" />
                    </Button>
                  ))}
                </div>
              </Field>
            )}
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
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save character"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
