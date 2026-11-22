"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { referenceSetNameLimit, type ReferenceSet } from "@/lib/reference-sets";
import { storage } from "@/lib/storage";
import { imagePreview, MAX_MEDIA_BYTES, MAX_MEDIA_ITEMS } from "./prompt/media";

export function ReferenceSetDialog({ files, onClose }: { files: File[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [id] = useState(() => crypto.randomUUID());

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !name.trim()) return;
    if (files.length > MAX_MEDIA_ITEMS || files.reduce((bytes, file) => bytes + file.size, 0) > MAX_MEDIA_BYTES) {
      setError(`Choose up to ${MAX_MEDIA_ITEMS} images totaling at most 20 MB.`);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const signal = new AbortController().signal;
      const images = await Promise.all(files.map(async (file) => ({
        name: file.name.slice(0, 512) || "Selected image", url: await imagePreview(file, signal),
      })));
      const unique = images.filter((image, index) => images.findIndex(({ url }) => url === image.url) === index);
      await storage(`reference-sets/${id}`, "PUT", { id, name: name.trim(), images: unique } satisfies ReferenceSet);
      toast.add({ title: `Saved reference set ${name.trim()}`, type: "success" });
      onClose();
    } catch {
      setError("Could not save the reference set. Check the selected images and try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose(); }}>
    <DialogContent showCloseButton={!saving}>
      <DialogHeader>
        <DialogTitle>Save reference set</DialogTitle>
        <DialogDescription>Reuse {files.length === 1 ? "this image" : `these ${files.length} images`} in storyboard shots across your workspace.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="reference-set-name">Name</FieldLabel>
          <Input id="reference-set-name" required maxLength={referenceSetNameLimit} placeholder="e.g. Harbor at dusk"
            disabled={saving} value={name} onChange={(event) => setName(event.target.value)} />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save set"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
