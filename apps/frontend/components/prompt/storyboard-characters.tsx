import { CheckIcon, ImageIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { storyCharacterNotesLimit, type StoryCharacter } from "./storyboard-data";

export function StoryboardCharacters({ characters, images, status, onEdit, onRemove, onGenerate, onStop }: {
  characters: StoryCharacter[];
  images: { name: string; url: string }[];
  status: string;
  onEdit: (index: number, change: Partial<StoryCharacter>) => void;
  onRemove: (index: number) => void;
  onGenerate: (index: number) => void;
  onStop: () => void;
}) {
  return <section aria-label="Storyboard cast" className="flex flex-col gap-3">
      {status && <div className="flex items-center gap-2">
        <p role="status" className="flex-1 text-sm text-muted-foreground">{status}</p>
        <Button variant="outline" size="sm" onClick={onStop}>Stop</Button>
      </div>}
      <ol className="flex flex-col divide-y">
        {characters.map((character, index) => {
          const selected = character.image === null ? undefined : images[character.image];
          const url = selected?.url ?? (character.generatedId ? `/api/storage/files/${character.generatedId}` : undefined);
          const name = character.name.trim() || `Character ${index + 1}`;
          return <li key={index} className="flex items-center gap-2 py-2 first:pt-0">
            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
              {url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={url} alt={`Reference for ${name}`} className="size-full object-cover" />
                : <ImageIcon aria-label="No reference" className="size-4" />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1">
                {character.image === null && !character.generatedId && <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{name}</span>}
                <Select value={character.image?.toString() ?? "none"} disabled={!!status} onValueChange={(value) => {
                  if (value !== null) onEdit(index, { image: value === "none" ? null : Number(value) });
                }}>
                  <SelectTrigger size="sm" aria-label="Main reference" className={character.image === null && !character.generatedId ? "max-w-28" : "min-w-0 flex-1"}>
                    <SelectValue>{selected?.name ?? (character.approved ? "Generated reference" : character.generatedId ? "Generated preview" : "Select reference")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent><SelectGroup>
                    {character.generatedId && <SelectItem value="none">Generated image</SelectItem>}
                    {images.map((image, position) => <SelectItem key={position} value={String(position)}>{image.name}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                {character.image === null && !character.approved && <>
                  <Button variant="ghost" size="icon-sm" aria-label={character.generatedId ? "Generate again" : "Generate reference"} title={character.generatedId ? "Generate again" : "Generate reference"}
                    disabled={!!status || !character.name.trim()} onClick={() => onGenerate(index)}>{character.generatedId ? <RefreshCwIcon /> : <ImageIcon />}</Button>
                  {character.generatedId && <Button size="icon-sm" aria-label="Use this reference" title="Use this reference" disabled={!!status} onClick={() => onEdit(index, { approved: true })}><CheckIcon /></Button>}
                </>}
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} title={`Remove ${name}`} disabled={!!status} onClick={() => onRemove(index)}><TrashIcon /></Button>
              </div>
              {character.image === null && !character.generatedId && <Textarea aria-label="Appearance" placeholder="Appearance" className="min-h-0 py-1.5" value={character.notes} maxLength={storyCharacterNotesLimit} rows={1} disabled={!!status}
                onChange={(event) => onEdit(index, { notes: event.target.value })} />}
            </div>
          </li>;
        })}
      </ol>
  </section>;
}
