import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { shotLimit, type Shot, type StoryCharacter } from "./storyboard-data";

export function StoryboardShots({ open, onOpenChange, shots, images, characters, busy, status, onEdit, onGenerate, onStop }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shots: Shot[];
  images: { name: string; url: string }[];
  characters: StoryCharacter[];
  busy: boolean;
  status: string;
  onEdit: (index: number, change: Partial<Shot>) => void;
  onGenerate: (index: number) => void;
  onStop: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[calc(var(--app-content-height)-2rem)] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Storyboard</DialogTitle>
        <DialogDescription>{shots.length} shots · {Number(shots.reduce((total, shot) => total + shot.seconds, 0).toFixed(2))} seconds</DialogDescription>
      </DialogHeader>
      {busy && <div className="flex items-center gap-2">
        <p role="status" className="flex-1 text-sm text-muted-foreground">{status}</p>
        <Button variant="outline" size="sm" onClick={onStop}>Stop</Button>
      </div>}
      <ol className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {shots.map((shot, index) => {
          const number = index + 1;
          const source = shot.image?.toString() ?? (shot.generatedId ? "generated" : "none");
          const url = shot.image !== null ? images[shot.image]?.url : shot.generatedId ? `/api/storage/files/${shot.generatedId}` : undefined;
          return <li key={index} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted">
              {url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={url} alt={`Shot ${number}`} className="size-full object-contain" />
                : <span className="flex items-center gap-2 text-sm text-muted-foreground"><ImageIcon className="size-4" />Needs an image</span>}
            </div>
            <FieldGroup className="min-w-0 gap-2">
              <Field>
                <FieldLabel htmlFor={`shot-${number}`}>Shot {number}</FieldLabel>
                <Textarea id={`shot-${number}`} rows={3} value={shot.description} maxLength={shotLimit} disabled={busy}
                  onChange={(event) => onEdit(index, { description: event.target.value })} />
              </Field>
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                <Field>
                  <FieldLabel htmlFor={`shot-time-${number}`}>Seconds</FieldLabel>
                  <Input id={`shot-time-${number}`} type="number" min={1} max={60} step="any" defaultValue={shot.seconds} disabled={busy}
                    onBlur={(event) => {
                      const value = event.target.valueAsNumber;
                      const seconds = Number.isFinite(value) ? Math.min(60, Math.max(1, value)) : shot.seconds;
                      event.target.value = String(seconds);
                      onEdit(index, { seconds });
                    }} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`shot-image-${number}`}>Image</FieldLabel>
                  <Select value={source} disabled={busy} onValueChange={(value) => {
                    if (value !== null) onEdit(index, { image: value === "none" || value === "generated" ? null : Number(value) });
                  }}>
                    <SelectTrigger id={`shot-image-${number}`} className="w-full"><SelectValue>{source === "generated" ? "Generated image" : source === "none" ? "Needs an image" : images[Number(source)]?.name}</SelectValue></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {shot.generatedId && <SelectItem value="generated">Generated image</SelectItem>}
                      {!shot.generatedId && <SelectItem value="none">Needs an image</SelectItem>}
                      {images.map(({ name }, imageIndex) => <SelectItem key={imageIndex} value={String(imageIndex)}>{name}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                </Field>
              </div>
              {shot.references.length > 0 && <p className="break-words text-xs text-muted-foreground">References · {shot.references.map((imageIndex) => images[imageIndex]?.name).join(", ")}</p>}
              {characters.length > 0 && <div role="group" aria-label={`Characters in shot ${number}`} className="flex flex-wrap gap-1">
                {characters.map(({ name }, position) => <Toggle key={position} variant="outline" size="sm" disabled={busy}
                  pressed={shot.characters?.includes(position) ?? false}
                  onPressedChange={(pressed) => onEdit(index, { characters: pressed
                    ? [...(shot.characters ?? []), position] : shot.characters?.filter((item) => item !== position) })}>
                  {name.trim() || `Character ${position + 1}`}
                </Toggle>)}
              </div>}
              {!url && <Button className="self-start" size="sm" disabled={busy || !shot.description.trim()} onClick={() => onGenerate(index)}>
                <ImageIcon data-icon="inline-start" />Generate image
              </Button>}
            </FieldGroup>
          </li>;
        })}
      </ol>
    </DialogContent>
  </Dialog>;
}
