import { useState } from "react";
import { CheckIcon, ImageIcon, RefreshCwIcon, SquareIcon, TrashIcon } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { storyCharacterNotesLimit, type StoryCharacter } from "./storyboard-data";

export function StoryboardCharacters({ characters, index, images, status, onEdit, onRemove, onGenerate, onStop }: {
  characters: StoryCharacter[];
  index: number;
  images: { name: string; url: string }[];
  status: string;
  onEdit: (index: number, change: Partial<StoryCharacter>) => void;
  onRemove: () => Promise<void>;
  onGenerate: () => void;
  onStop: () => void;
}) {
  const [removal, setRemoval] = useState<{ name: string; confirm: () => Promise<void> } | null>(null);
  const character = characters[index];
  if (!character) return null;
  const selected = character.image === null ? undefined : images[character.image];
  const url = selected?.url ?? (character.generatedId ? `/api/storage/files/${character.generatedId}` : undefined);
  const name = character.name.trim() || `Character ${index + 1}`;
  const canGenerate = character.image === null && !character.approved;

  return <section aria-label={`Reference for ${name}`} className="grid gap-3 border-t bg-muted/25 p-3">
    {status && <div className="flex items-center gap-2">
      <p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">{status}</p>
      <Button variant="outline" size="sm" onClick={onStop}><SquareIcon data-icon="inline-start" />Stop</Button>
    </div>}
    <div className="flex min-w-0 items-center gap-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Reference for ${name}`} className="size-12 shrink-0 rounded-full border object-cover" />
      )}
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="text-xs font-medium">Main reference</span>
        <Select value={character.image?.toString() ?? "none"} disabled={!!status || !images.length} onValueChange={(value) => {
          if (value !== null) onEdit(index, { image: value === "none" ? null : Number(value) });
        }}>
          <SelectTrigger size="sm" aria-label="Main reference" className="w-full min-w-0">
            <SelectValue>{selected?.name ?? (character.approved ? "Generated reference" : character.generatedId ? "Generated preview" : images.length ? "Choose an attached image" : "No attached images")}</SelectValue>
          </SelectTrigger>
          <SelectContent><SelectGroup>
            {character.generatedId && <SelectItem value="none">Generated image</SelectItem>}
            {images.map((image, position) => <SelectItem key={position} value={String(position)}>{image.name}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
      </div>
    </div>
    {canGenerate && !character.generatedId && <label className="grid min-w-0 gap-1 text-xs font-medium">
      Appearance
      <Textarea placeholder="Face, clothing, and distinguishing details" className="min-h-0 py-1.5" value={character.notes}
        maxLength={storyCharacterNotesLimit} rows={2} disabled={!!status}
        onChange={(event) => onEdit(index, { notes: event.target.value })} />
    </label>}
    <div className="flex flex-wrap items-center gap-2">
      <Tip label="Remove character"><Button variant="ghost" size="icon-sm" className="text-muted-foreground"
        aria-label={`Remove ${name} from storyboard`}
        disabled={!!status} onClick={() => setRemoval({ name, confirm: onRemove })}><TrashIcon /></Button></Tip>
      {removal && <ConfirmDelete open onOpenChange={(open) => { if (!open) setRemoval(null); }} title="Remove character?"
        description={`${removal.name} will be removed from the storyboard and its shot assignments will be cleared.`}
        actionLabel="Remove" onConfirm={removal.confirm} />}
      {canGenerate && <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" disabled={!!status || !character.name.trim()} onClick={onGenerate}>
          {character.generatedId ? <RefreshCwIcon data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
          {character.generatedId ? "Generate again" : "Generate reference"}
        </Button>
        {character.generatedId && <Button size="sm" disabled={!!status} onClick={() => onEdit(index, { approved: true })}>
          <CheckIcon data-icon="inline-start" />Use this reference
        </Button>}
      </div>}
    </div>
  </section>;
}
