import { useEffect, useState } from "react";
import { SquareIcon, SquareCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReferenceSet } from "@/lib/reference-sets";
import { storage } from "@/lib/storage";
import type { Shot } from "./storyboard-data";

export function StoryboardReferenceSetDialog({ shots, onApply, onClose }: {
  shots: Shot[];
  onApply: (set: ReferenceSet, shotIds: ReadonlySet<string>) => void;
  onClose: () => void;
}) {
  const [sets, setSets] = useState<ReferenceSet[]>();
  const [setId, setSetId] = useState<string | null>(null);
  const [selected, setSelected] = useState(() => new Set(shots.flatMap(({ id }) => id ? [id] : [])));
  const [error, setError] = useState("");
  const active = sets?.find(({ id }) => id === setId);

  useEffect(() => {
    let cancelled = false;
    void storage("reference-sets").then((rows: { value: ReferenceSet }[]) => {
      if (!cancelled) setSets(rows.map(({ value }) => value).sort((a, b) => a.name.localeCompare(b.name)));
    }, () => { if (!cancelled) setError("Could not load reference sets."); });
    return () => { cancelled = true; };
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setError("");
  }

  function apply() {
    if (!active || !selected.size) return;
    try {
      onApply(active, selected);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not apply the reference set.");
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Apply reference set</DialogTitle>
        <DialogDescription>Add saved images to the selected shots’ references.</DialogDescription>
      </DialogHeader>
      {sets?.length ? <FieldGroup>
        <Field>
          <FieldLabel htmlFor="storyboard-reference-set">Reference set</FieldLabel>
          <Select value={setId} onValueChange={(id) => { setSetId(id); setError(""); }}
            items={sets.map(({ id, name }) => ({ value: id, label: name }))}>
            <SelectTrigger id="storyboard-reference-set" className="w-full min-w-0">
              <SelectValue placeholder="Choose a set" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}><SelectGroup>
              {sets.map(({ id, name, images }) => <SelectItem key={id} value={id} label={name}>
                {name} · {images.length} {images.length === 1 ? "image" : "images"}
              </SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          {active && <div className="flex flex-wrap gap-2">
            {active.images.map(({ url, name }, index) =>
              // eslint-disable-next-line @next/next/no-img-element
              <img key={index} src={url} alt={name} className="size-12 rounded-md border object-cover" />)}
          </div>}
        </Field>
        <FieldSet>
          <FieldLegend>Shots</FieldLegend>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {shots.map(({ id, scene, description }, index) => {
              if (!id) return null;
              const checked = selected.has(id);
              return <Button key={id} variant="outline" size="sm" role="checkbox" aria-checked={checked} className="justify-start"
                onClick={() => toggle(id)}>
                {checked ? <SquareCheckIcon data-icon="inline-start" /> : <SquareIcon data-icon="inline-start" />}
                <span className="shrink-0">Shot {index + 1}</span><span className="truncate text-muted-foreground">{scene || description}</span>
              </Button>;
            })}
          </div>
        </FieldSet>
      </FieldGroup> : !error && <p role="status" className="text-sm text-muted-foreground">{sets
        ? "Right-click selected canvas images and choose Save reference set to create one."
        : "Loading reference sets…"}</p>}
      {error && <FieldError>{error}</FieldError>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!active || !selected.size} onClick={apply}>Apply to {selected.size} {selected.size === 1 ? "shot" : "shots"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
