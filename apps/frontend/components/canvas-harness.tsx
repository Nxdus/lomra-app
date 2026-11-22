"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canvasCardType, canvasLinkLimit, canvasRoles, canvasRelations, canvasTextLimit, canvasTitleLimit, type CanvasHarness, type CanvasLink } from "@/lib/image-canvas/canvas-harness";
import type { CanvasImage } from "@/lib/image-canvas/image-canvas-storage";
import { canvasHandoff, canvasHandoffZip } from "@/lib/image-canvas/canvas-harness-export";

const itemTitle = (item: CanvasImage) => item.harness?.title ?? item.file.name;

export function CanvasCardDialog({ item, items, onClose, onSave }: {
  item?: CanvasImage;
  items: CanvasImage[];
  onClose: () => void;
  onSave: (harness: CanvasHarness) => void;
}) {
  const id = useId();
  const card = !item || item.file.type === canvasCardType;
  const [role, setRole] = useState<(typeof canvasRoles)[number] | "Unassigned">(item?.harness?.role ?? (card ? "Brief" : "Unassigned"));
  const [title, setTitle] = useState(item?.harness?.title ?? "");
  const [notes, setNotes] = useState(item?.harness?.notes ?? "");
  const [links, setLinks] = useState(item?.harness?.links ?? []);
  const [target, setTarget] = useState<string | null>(null);
  const [relation, setRelation] = useState<CanvasLink["relation"]>("Uses reference");
  const targets = items.filter(other => other.id !== item?.id);
  const byId = new Map(targets.map(other => [other.id, other]));
  const targetItems = targets.map(other => ({ value: other.id, label: `${itemTitle(other)} · ${other.id.slice(0, 8)}` }));
  const provenance = item?.harness?.provenance;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogTitle className="pr-8">{item ? "Canvas details" : "Add canvas card"}</DialogTitle>
      <DialogDescription>{item ? itemTitle(item) : "Add a brief, reference note or output note to the canvas."}</DialogDescription>
      <form onSubmit={event => {
        event.preventDefault();
        if (card && !title.trim()) return;
        onSave({ role: role === "Unassigned" ? undefined : role, title: title.trim() || undefined, notes: notes.trim() || undefined, links, provenance });
      }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
            <Select value={role} onValueChange={value => { if (value) setRole(value); }}>
              <SelectTrigger id={`${id}-role`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {!card && <SelectItem value="Unassigned">Unassigned</SelectItem>}
                {canvasRoles.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
            <Input id={`${id}-title`} value={title} required={card} maxLength={canvasTitleLimit} onChange={event => setTitle(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
            <Textarea id={`${id}-notes`} value={notes} maxLength={canvasTextLimit} onChange={event => setNotes(event.target.value)} />
          </Field>
          {targets.length > 0 && <Field>
            <FieldLabel htmlFor={`${id}-target`}>Link to another canvas item</FieldLabel>
            <Select value={target} onValueChange={setTarget} items={targetItems}>
              <SelectTrigger id={`${id}-target`} className="w-full"><SelectValue placeholder="Choose an item" /></SelectTrigger>
              <SelectContent><SelectGroup>{targetItems.map(other =>
                <SelectItem key={other.value} value={other.value}>{other.label}</SelectItem>
              )}</SelectGroup></SelectContent>
            </Select>
            <div className="flex gap-2">
              <Select value={relation} onValueChange={value => { if (value) setRelation(value); }}>
                <SelectTrigger aria-label="Link type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{canvasRelations.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Button type="button" variant="outline" disabled={!target || links.length >= canvasLinkLimit || links.some(link => link.to === target && link.relation === relation)} onClick={() => {
                if (target) setLinks([...links, { to: target, relation }]);
              }}>Add link</Button>
            </div>
            {links.map((link, index) => <div key={`${link.to}:${link.relation}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-words">{link.relation} · {byId.has(link.to) ? itemTitle(byId.get(link.to)!) : "Missing item"}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLinks(links.filter((_, i) => i !== index))}>Remove</Button>
            </div>)}
          </Field>}
          {provenance && <section className="flex flex-col gap-2">
            <h3 className="font-medium">Generation</h3>
            <p className="break-words">Model · {provenance.model}</p>
            <p className="whitespace-pre-wrap break-words">{provenance.prompt}</p>
            {!!provenance.selectedInputs?.length && <p className="break-words">Selected inputs · {provenance.selectedInputs.map(input => input.name).join(", ")}</p>}
          </section>}
        </FieldGroup>
        <DialogFooter className="mt-6"><Button type="submit" disabled={card && !title.trim()}>Save</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function CanvasHandoffDialog({ items, ids, onClose }: { items: CanvasImage[]; ids: string[]; onClose: () => void }) {
  const [handoff] = useState(() => canvasHandoff(items, new Set(ids)));
  const [markdown, setMarkdown] = useState(handoff.markdown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const url = URL.createObjectURL(await canvasHandoffZip(markdown, handoff.assets));
      const link = document.createElement("a");
      link.href = url;
      link.download = "canvas-handoff.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export handoff.");
    } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
      <DialogTitle>Export canvas selection</DialogTitle>
      <DialogDescription>{ids.length} selected items · {handoff.assets.length} media files</DialogDescription>
      <Field>
        <FieldLabel htmlFor="canvas-handoff-markdown">Markdown</FieldLabel>
        <Textarea id="canvas-handoff-markdown" className="h-64 font-mono" value={markdown} onChange={event => setMarkdown(event.target.value)} disabled={busy} />
      </Field>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <DialogFooter><Button onClick={() => void download()} disabled={busy}>{busy ? "Preparing ZIP…" : "Download ZIP"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function CanvasLinks({ items }: { items: CanvasImage[] }) {
  const marker = useId();
  const byId = new Map(items.map(item => [item.id, item]));
  return <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground">
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
    </marker></defs>
    {items.flatMap(item => item.harness?.links?.map(({ to, relation }) => {
      const target = byId.get(to);
      if (!target) return null;
      const right = target.x + target.width / 2 >= item.x + item.width / 2;
      const startX = right ? item.x + item.width : item.x;
      const endX = right ? target.x : target.x + target.width;
      const startY = item.y + item.height / 2;
      const endY = target.y + target.height / 2;
      const bend = Math.max(28, Math.abs(endX - startX) / 2) * (right ? 1 : -1);
      const shift = relation === "Uses reference" ? 7 : -7;
      return <path key={`${item.id}:${to}:${relation}`} d={`M ${startX} ${startY + shift} C ${startX + bend} ${startY + shift}, ${endX - bend} ${endY + shift}, ${endX} ${endY + shift}`} stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray={relation === "Uses reference" ? "5 4" : undefined} markerEnd={`url(#${marker})`} />;
    }) ?? [])}
  </svg>;
}
