import { useEffect, useState } from "react";
import { CheckIcon, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReferenceSet } from "@/lib/reference-sets";
import { storage } from "@/lib/storage";
import type { Shot } from "./storyboard-data";

export function StoryboardReferenceSetDialog({ shots, images, onApply, onClose }: {
  shots: Shot[];
  images: { url: string }[];
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
    <DialogContent className="flex min-w-0 flex-col gap-0 overflow-hidden rounded-3xl p-0">
      <DialogHeader className="shrink-0 border-b px-4 pt-5 pb-4 pr-14 sm:px-5 sm:pr-14">
        <DialogTitle>Apply reference set</DialogTitle>
        <DialogDescription className="sr-only">Choose a set and the shots that should use it.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5">
        {sets?.length ? <FieldGroup className="gap-4">
          <FieldSet className="min-w-0 gap-2">
            <FieldLegend variant="label" className="mb-1">Reference set</FieldLegend>
            <ToggleGroup orientation="vertical" aria-label="Reference set" spacing={0}
              variant="outline" size="sm" value={setId ? [setId] : []}
              onValueChange={([id]) => { if (id) { setSetId(id); setError(""); } }}
              className="max-h-32 w-full overflow-y-auto p-1">
              {sets.map(({ id, name, images }) => <ToggleGroupItem key={id} value={id} className="min-w-0 justify-start">
                <span className="min-w-0 flex-1 truncate text-left">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{images.length} {images.length === 1 ? "image" : "images"}</span>
                <CheckIcon data-icon="inline-end" className={id === setId ? "visible" : "invisible"} />
              </ToggleGroupItem>)}
            </ToggleGroup>
            {active && <div className="flex flex-wrap gap-1.5 px-1">
              {active.images.map(({ url, name }) =>
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt={name} className="size-9 rounded-md border object-cover" />)}
            </div>}
          </FieldSet>
          <FieldSet className="min-w-0">
            <FieldLegend variant="label" className="mb-1">Shots</FieldLegend>
            <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(min(100%,7.5rem),1fr))] gap-2 overflow-y-auto p-1">
              {shots.map(({ id, scene, description, image, generatedId }, index) => {
                if (!id) return null;
                const url = image !== null ? images[image]?.url : generatedId && `/api/storage/files/${generatedId}`;
                const title = scene?.trim() || description.trim() || "Untitled shot";
                return <Label key={id} className="group flex min-w-0 cursor-pointer flex-col items-stretch gap-2 rounded-xl border bg-card p-1.5 hover:bg-muted has-checked:border-primary has-checked:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input type="checkbox" className="sr-only" checked={selected.has(id)} onChange={() => toggle(id)} />
                  <span className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                    {url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={url} alt="" className="size-full object-cover" />
                      : <ImageIcon aria-hidden="true" className="size-4" />}
                    <span className="absolute top-1 left-1 rounded-md bg-background px-1.5 py-1 text-[11px] text-foreground tabular-nums">Shot {index + 1}</span>
                    <span aria-hidden="true" className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md border border-input bg-background group-has-checked:border-primary group-has-checked:bg-primary group-has-checked:text-primary-foreground">
                      <CheckIcon className="invisible size-3 group-has-checked:visible" />
                    </span>
                  </span>
                  <span className="line-clamp-2 px-0.5 pb-0.5 text-xs leading-snug" title={title}>{title}</span>
                </Label>;
              })}
            </div>
          </FieldSet>
        </FieldGroup> : !error && <p role="status" className="text-sm text-muted-foreground">{sets
          ? "Right-click selected canvas images and choose Save reference set to create one."
          : "Loading reference sets…"}</p>}
        {error && <FieldError>{error}</FieldError>}
      </div>
      <DialogFooter className="shrink-0 flex-row flex-wrap justify-end border-t px-4 py-3 sm:px-5">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!active || !selected.size} onClick={apply}>Apply to {selected.size} {selected.size === 1 ? "shot" : "shots"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
