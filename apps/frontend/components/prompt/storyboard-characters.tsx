import { ImageIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { maxStoryCharacters, storyCharacterNotesLimit, type StoryCharacter } from "./storyboard-data";

export function StoryboardCharacters({ open, onOpenChange, characters, images, status, onAdd, onEdit, onRemove, onGenerate, onStop }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characters: StoryCharacter[];
  images: { name: string; url: string }[];
  status: string;
  onAdd: () => void;
  onEdit: (index: number, change: Partial<StoryCharacter>) => void;
  onRemove: (index: number) => void;
  onGenerate: (index: number) => void;
  onStop: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[calc(var(--app-content-height)-2rem)] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Storyboard characters</DialogTitle>
        <DialogDescription>Set the appearance and main reference image for each recurring character.</DialogDescription>
      </DialogHeader>
      {status && <div className="flex items-center gap-2">
        <p role="status" className="flex-1 text-sm text-muted-foreground">{status}</p>
        <Button variant="outline" size="sm" onClick={onStop}>Stop</Button>
      </div>}
      <ol className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {characters.map((character, index) => {
          const selected = character.image === null ? undefined : images[character.image];
          const url = selected?.url ?? (character.generatedId ? `/api/storage/files/${character.generatedId}` : undefined);
          const name = character.name.trim() || `Character ${index + 1}`;
          return <li key={index} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
              {url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={url} alt={`Reference for ${name}`} className="size-full object-contain" />
                : <span className="flex items-center gap-2 text-sm text-muted-foreground"><ImageIcon className="size-4" />No reference</span>}
            </div>
            <FieldGroup className="min-w-0 gap-2">
              <Field>
                <FieldLabel htmlFor={`character-name-${index}`}>Name</FieldLabel>
                <Input id={`character-name-${index}`} value={character.name} maxLength={64} disabled={!!status}
                  onChange={(event) => onEdit(index, { name: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`character-notes-${index}`}>Appearance</FieldLabel>
                <Textarea id={`character-notes-${index}`} value={character.notes} maxLength={storyCharacterNotesLimit} rows={3} disabled={!!status}
                  onChange={(event) => onEdit(index, { notes: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`character-image-${index}`}>Main reference</FieldLabel>
                <Select value={character.image?.toString() ?? "none"} disabled={!!status} onValueChange={(value) => {
                  if (value !== null) onEdit(index, { image: value === "none" ? null : Number(value) });
                }}>
                  <SelectTrigger id={`character-image-${index}`} className="w-full">
                    <SelectValue>{selected?.name ?? (character.approved ? "Generated reference" : character.generatedId ? "Generated preview" : "No reference")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="none">{character.generatedId ? "Generated image" : "No reference"}</SelectItem>
                    {images.map((image, position) => <SelectItem key={position} value={String(position)}>{image.name}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
              </Field>
              <div className="flex flex-wrap justify-between gap-2">
                {character.image === null && !character.approved && <>
                  {character.generatedId && <Button size="sm" disabled={!!status} onClick={() => onEdit(index, { approved: true })}>Use this reference</Button>}
                  <Button size="sm" variant="outline" disabled={!!status || !character.name.trim()} onClick={() => onGenerate(index)}>
                    <ImageIcon data-icon="inline-start" />{character.generatedId ? "Generate again" : "Generate reference"}
                  </Button>
                </>}
                <Button className="ml-auto" variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={!!status} onClick={() => onRemove(index)}><TrashIcon /></Button>
              </div>
            </FieldGroup>
          </li>;
        })}
      </ol>
      <Button size="sm" variant="outline" className="self-start" disabled={!!status || characters.length >= maxStoryCharacters} onClick={onAdd}>
        <PlusIcon data-icon="inline-start" />Add character
      </Button>
    </DialogContent>
  </Dialog>;
}
