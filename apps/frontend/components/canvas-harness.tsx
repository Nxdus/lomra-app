"use client";

import { useId, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { CanvasItemSummary, ItemThumbnail } from "@/components/canvas-details";
import type { VisibleImage } from "@/components/image-canvas";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { canvasCardType, canvasLinkLimit, canvasRoles, canvasRelations, canvasTextLimit, canvasTitleLimit, type CanvasHarness, type CanvasLink } from "@/lib/image-canvas/canvas-harness";
import type { CanvasImage } from "@/lib/image-canvas/image-canvas-storage";
import { canvasHandoff, canvasHandoffZip } from "@/lib/image-canvas/canvas-harness-export";

const itemTitle = (item: CanvasImage) => item.harness?.title ?? item.file.name;

export function CanvasCardDialog({ item, items, onLoaded, onClose, onSave, onUseSetup, onMakeVariations, onGenerateAgain, busy }: {
  item?: VisibleImage;
  items: VisibleImage[];
  onLoaded: (id: string, file: File) => void;
  onClose: () => void;
  onSave: (harness: CanvasHarness) => void;
  onUseSetup?: (item: VisibleImage) => void;
  onMakeVariations?: (item: VisibleImage) => void;
  onGenerateAgain?: (item: VisibleImage) => void;
  busy?: boolean;
}) {
  const id = useId();
  const card = !item || item.file.type === canvasCardType;
  const [role, setRole] = useState<(typeof canvasRoles)[number] | "Unassigned">(item?.harness?.role ?? (card ? "Brief" : "Unassigned"));
  const [title, setTitle] = useState(item?.harness?.title ?? "");
  const [notes, setNotes] = useState(item?.harness?.notes ?? "");
  const [links, setLinks] = useState(item?.harness?.links ?? []);
  const [linking, setLinking] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [relation, setRelation] = useState<CanvasLink["relation"]>("Uses reference");
  const addLink = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const targets = items.filter(other => other.id !== item?.id);
  const byId = new Map(targets.map(other => [other.id, other]));
  const targetItems = targets.map(other => ({ value: other.id, label: `${itemTitle(other)} · ${other.id.slice(0, 8)}` }));
  const provenance = item?.harness?.provenance;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent initialFocus={card ? titleInput : heading} className={card ? undefined : "sm:max-w-3xl"}>
      <DialogHeader className="pr-10">
        <DialogTitle ref={heading} tabIndex={-1} className="truncate leading-normal outline-none" title={item && itemTitle(item)}>{item && <span className="sr-only">Canvas details · </span>}{item ? itemTitle(item) : "Add canvas card"}</DialogTitle>
        <DialogDescription className={item ? "sr-only" : undefined}>{item ? "Role, title, notes and links of this item." : "Add a brief, reference note or output note to the canvas."}</DialogDescription>
      </DialogHeader>
      <div className={card ? undefined : "grid gap-6 md:grid-cols-2"}>
      {!card && <CanvasItemSummary item={item} items={items} onLoaded={onLoaded} busy={busy}
        onUseSetup={onUseSetup ? (chosen) => { onClose(); onUseSetup(chosen); } : undefined}
        onMakeVariations={onMakeVariations ? (chosen) => { onClose(); onMakeVariations(chosen); } : undefined}
        onGenerateAgain={onGenerateAgain ? (chosen) => { onClose(); onGenerateAgain(chosen); } : undefined} />}
      <form className="flex min-w-0 flex-col gap-6" onSubmit={event => {
        event.preventDefault();
        if (card && !title.trim()) return;
        onSave({ role: role === "Unassigned" ? undefined : role, title: title.trim() || undefined, notes: notes.trim() || undefined, links, provenance });
      }}>
        <FieldGroup className="gap-5">
          <Field>
            <FieldTitle id={`${id}-role`}>Role</FieldTitle>
            <ToggleGroup aria-labelledby={`${id}-role`} className="w-full rounded-4xl bg-muted p-[3px]" spacing={0} size="sm" value={[role]} onValueChange={([value]) => { if (value) setRole(value as typeof role); }}>
              {(card ? canvasRoles : ["Unassigned", ...canvasRoles] as const).map(value => <ToggleGroupItem key={value} value={value} className="min-w-0 flex-1 rounded-4xl! px-2 text-foreground/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:bg-input/30">{value === "Unassigned" ? "None" : value}</ToggleGroupItem>)}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
            <Input ref={titleInput} id={`${id}-title`} value={title} required={card} maxLength={canvasTitleLimit} placeholder={item && !card ? item.file.name : undefined} onChange={event => setTitle(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
            <Textarea id={`${id}-notes`} className="max-h-48" value={notes} maxLength={canvasTextLimit} onChange={event => setNotes(event.target.value)} />
          </Field>
          {(targets.length > 0 || links.length > 0) && <Field>
            <FieldTitle id={`${id}-links`}>Links</FieldTitle>
            {links.length > 0 && <ul aria-labelledby={`${id}-links`} className="flex flex-col gap-2">{links.map((link, index) => {
              const name = byId.has(link.to) ? itemTitle(byId.get(link.to)!) : "Missing item";
              return <li key={`${link.to}:${link.relation}`} className="flex items-center gap-3">
                <ItemThumbnail item={byId.get(link.to)} />
                <div className="min-w-0 flex-1"><div className="truncate" title={name}>{name}</div><div className="text-xs text-muted-foreground">{link.relation}</div></div>
                <Tip label="Remove link"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove link to ${name}`} onClick={() => { setLinks(links.filter((_, i) => i !== index)); addLink.current?.focus(); }}><XIcon /></Button></Tip>
              </li>;
            })}</ul>}
            {linking ? <div className="flex flex-col gap-2 rounded-3xl border p-3">
              <Select value={target} onValueChange={setTarget} items={targetItems}>
                <SelectTrigger autoFocus aria-label="Item to link to" className="w-full min-w-0"><SelectValue placeholder="Choose an item" className="truncate" /></SelectTrigger>
                <SelectContent><SelectGroup>{targetItems.map(other =>
                  <SelectItem key={other.value} value={other.value}>{other.label}</SelectItem>
                )}</SelectGroup></SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2">
                <Select value={relation} onValueChange={value => { if (value) setRelation(value); }}>
                  <SelectTrigger aria-label="Link type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{canvasRelations.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <Button type="button" variant="ghost" className="ml-auto" onClick={() => { setLinking(false); setTarget(null); }}>Cancel</Button>
                <Button type="button" variant="secondary" disabled={!target || links.length >= canvasLinkLimit || links.some(link => link.to === target && link.relation === relation)} onClick={() => {
                  if (target) setLinks([...links, { to: target, relation }]);
                  setLinking(false);
                  setTarget(null);
                }}>Add</Button>
              </div>
            </div> : targets.length > 0 && <Button ref={addLink} type="button" variant="outline" size="sm" className="w-fit!" disabled={links.length >= canvasLinkLimit} onClick={() => setLinking(true)}><PlusIcon data-icon="inline-start" />Add link</Button>}
          </Field>}
        </FieldGroup>
        <DialogFooter className="mt-auto"><Button type="submit" disabled={card && !title.trim()}>Save</Button></DialogFooter>
      </form>
      </div>
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
