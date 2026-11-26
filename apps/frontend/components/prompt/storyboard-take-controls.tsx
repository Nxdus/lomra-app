import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Shot } from "./storyboard-data";
import { videoStartImage } from "./generation";
import { matchingShotTakeJob, shotTakes } from "./storyboard-takes";

export function StoryboardTakes({ shot, model, aspectRatio, disabled, price, onSelect, onGenerate }: {
  shot: Shot;
  model: string;
  aspectRatio?: string;
  disabled?: boolean;
  price?: string;
  onSelect: (fileId: string) => void;
  // Run the paid confirmation for "generate", then call generateShotTake.
  onGenerate: (action: "generate" | "resume") => void;
}) {
  const takes = shotTakes(shot);
  const selected = takes.find((take) => take.selected);
  const pending = shot.pendingTake;
  const earlierInputs = pending && !matchingShotTakeJob(shot, pending.model, pending.aspectRatio);
  const earlierRatio = pending && pending.aspectRatio !== (aspectRatio ?? "16:9");
  const items = takes.map((take, index) => ({
    value: take.fileId,
    label: `Take ${index + 1}${take.stale ? " · Stale" : ""}`,
  }));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 && (
          <Select items={items} value={selected?.fileId ?? null} onValueChange={(id) => { if (id) onSelect(id); }} disabled={disabled}>
            <SelectTrigger aria-label="Selected clip take"><SelectValue placeholder="Select take" /></SelectTrigger>
            <SelectContent>{items.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Button type="button" variant="outline"
          disabled={disabled || (!pending && (!model || !videoStartImage(model) || (shot.image === null && !shot.generatedId)))}
          onClick={() => onGenerate(pending ? "resume" : "generate")}>
          {pending ? "Check job" : takes.length ? "Generate another take" : "Generate take"}
        </Button>
        {!pending && price && <span className="text-sm text-muted-foreground">{price}</span>}
      </div>
      {selected && <video key={selected.fileId} controls playsInline preload="metadata" aria-label="Selected clip take"
        className="max-h-52 w-full rounded-md bg-black focus-visible:ring-2 focus-visible:ring-ring" src={`/api/storage/files/${encodeURIComponent(selected.fileId)}`} />}
      {selected?.stale && <p className="text-sm text-muted-foreground">This take uses an earlier first frame or prompt.</p>}
      {pending && <p className="text-sm text-muted-foreground">
        Saved job model {pending.model}{earlierRatio ? ` · ${pending.aspectRatio}` : ""}
        {earlierInputs ? ". The result uses an earlier first frame or prompt." : ""}
      </p>}
    </div>
  );
}
