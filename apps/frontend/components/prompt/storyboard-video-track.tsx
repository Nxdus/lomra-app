import { FilmIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Shot } from "./storyboard-data";
import { shotTakes } from "./storyboard-takes";
import { timelineShotClip, type StoryboardTimelineEdit, type TimelineTrim } from "./storyboard-timeline-data";

function timecode(seconds: number) {
  const hundredths = Math.round(seconds * 100);
  const minutes = Math.floor(hundredths / 6000);
  const whole = Math.floor(hundredths / 100) % 60;
  const fraction = String(hundredths % 100).padStart(2, "0").replace(/0+$/, "");
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}

export function StoryboardVideoTrack({ shots, images, edit, busy, onSelectTake, onTrim }: {
  shots: Shot[];
  images: readonly { url: string }[];
  edit: StoryboardTimelineEdit;
  busy: boolean;
  onSelectTake: (shotId: string, fileId: string) => void;
  onTrim: (trim: TimelineTrim) => void;
}) {
  const [selected, setSelected] = useState(0);
  if (!shots.length) return <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Add a shot to start the video track.</p>;

  const clips = shots.map((shot) => {
    const { fileId, ...trim } = timelineShotClip(shot, edit);
    const length = trim.end - trim.start;
    const seconds = Number.isFinite(length) && length >= 1 && length <= 60 ? length : shot.seconds;
    return {
      shot, fileId, trim, seconds,
      picture: (shot.image === null ? undefined : images[shot.image]?.url) ??
        (shot.generatedId ? `/api/storage/files/${encodeURIComponent(shot.generatedId)}` : undefined),
    };
  });
  const offsets = [0];
  for (const { seconds } of clips) offsets.push(offsets[offsets.length - 1] + seconds);
  const active = Math.min(selected, clips.length - 1);
  const { shot, fileId, trim } = clips[active];
  const items = shotTakes(shot).map((take, index) => ({ value: take.fileId, label: `Take ${index + 1}${take.stale ? " · Stale" : ""}` }));
  const minWidth = Math.ceil(64 * offsets[clips.length] / Math.min(...clips.map(({ seconds }) => seconds)));

  return (
    <section aria-label="Video track" className="space-y-3">
      <div className="rounded-2xl border bg-card p-3 text-card-foreground sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium"><FilmIcon aria-hidden="true" className="size-4 text-muted-foreground" />Video track</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{clips.length} {clips.length === 1 ? "shot" : "shots"}</span>
        </div>
        <div className="overflow-x-auto pb-1">
          <div role="group" aria-label="Select a storyboard shot" className="grid" style={{
            gridTemplateColumns: clips.map(({ seconds }) => `${seconds}fr`).join(" "),
            minWidth,
          }}>
            {clips.map(({ shot, picture, fileId, trim }, index) => (
              <div key={shot.id ?? index} className="min-w-0">
                <div aria-hidden="true" className="h-6 overflow-hidden whitespace-nowrap border-l pl-1.5 text-xs leading-4 tabular-nums text-muted-foreground">{timecode(offsets[index])}</div>
                <Button type="button" variant="ghost" disabled={busy} aria-pressed={index === active} aria-label={`Shot ${index + 1}${shot.scene ? `, ${shot.scene}` : ""}${fileId ? "" : ", no selected take"}`}
                  onClick={(event) => {
                    setSelected(index);
                    event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                  }}
                  className={cn(
                    "relative h-20 w-full justify-start overflow-hidden rounded-none border-0 border-r-2 border-card bg-muted p-0 text-left text-foreground hover:bg-accent focus-visible:z-10 focus-visible:ring-inset focus-visible:ring-ring sm:h-24",
                    index === active && "z-1 after:pointer-events-none after:absolute after:inset-0 after:rounded-sm after:ring-2 after:ring-ring after:ring-inset",
                  )}>
                  {picture && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={picture} alt="" className="absolute inset-0 size-full object-cover" />
                  )}
                  {picture && <span className="absolute inset-0 bg-linear-to-t from-black/90 via-black/20 to-black/20" aria-hidden="true" />}
                  <span className={cn("absolute top-1.5 left-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tabular-nums", picture ? "bg-black/65 text-white" : "bg-background")}>{String(index + 1).padStart(2, "0")}</span>
                  {trim.mute && <VolumeXIcon aria-hidden="true" className={cn("absolute top-2 right-2 size-3.5", picture && "text-white drop-shadow-md")} />}
                  <span className={cn("absolute inset-x-2 bottom-1.5 truncate text-xs font-medium", picture && "text-white")}>{fileId ? shot.scene || `Shot ${index + 1}` : "No take"}</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <fieldset disabled={busy} className="min-w-0 rounded-xl border px-3 pt-1 pb-3 sm:px-4">
        <legend className="max-w-full truncate px-1.5 text-sm font-medium">Shot {active + 1}{shot.scene && ` · ${shot.scene}`}</legend>
        {shot.description && <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{shot.description}</p>}
        <div className="grid grid-cols-2 items-end gap-2.5 sm:grid-cols-[minmax(7rem,1.2fr)_1fr_1fr_auto]">
          {!!items.length && <div className="grid gap-1 text-xs font-medium">
            <span>Take</span>
            <Select items={items} value={fileId ?? null} disabled={busy || !shot.id}
              onValueChange={(takeId) => { if (shot.id && takeId) onSelectTake(shot.id, takeId); }}>
              <SelectTrigger aria-label={`Selected take for shot ${active + 1}`} className="w-full min-w-0"><SelectValue placeholder="Select take" /></SelectTrigger>
              <SelectContent>{items.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          {fileId ? <>
            <label className="grid min-w-0 gap-1 text-xs font-medium">
              Trim start (s)
              <Input type="number" min={0} step="any" value={Number.isFinite(trim.start) ? trim.start : ""}
                onChange={(event) => onTrim({ fileId, ...trim, start: event.target.valueAsNumber })} />
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-medium">
              Trim end (s)
              <Input type="number" min={0} step="any" value={Number.isFinite(trim.end) ? trim.end : ""}
                onChange={(event) => onTrim({ fileId, ...trim, end: event.target.valueAsNumber })} />
            </label>
            <label className="flex h-9 items-center gap-2 px-1 text-sm">
              {trim.mute ? <VolumeXIcon aria-hidden="true" className="size-4 text-muted-foreground" /> : <Volume2Icon aria-hidden="true" className="size-4 text-muted-foreground" />}
              <Switch aria-label="Mute clip audio" checked={trim.mute} disabled={busy} onCheckedChange={(mute) => onTrim({ fileId, ...trim, mute })} />
              Mute
            </label>
          </> : <p className="col-span-full text-sm text-muted-foreground">Choose a take to trim this shot.</p>}
        </div>
      </fieldset>
    </section>
  );
}
