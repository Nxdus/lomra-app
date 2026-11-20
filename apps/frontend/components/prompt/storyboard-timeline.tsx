"use client";

import { useRef, useState } from "react";
import { AudioLinesIcon, CaptionsIcon, DownloadIcon, FilmIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { storageFile } from "@/lib/storage";
import type { Storyboard } from "./storyboard-data";
import { StoryboardVideoTrack } from "./storyboard-video-track";
import { StoryboardTimedTrack } from "./storyboard-timed-track";
import {
  defaultTimeline, maxTimelineAudio, maxTimelineCaptions, maxTimelineCaptionLength, maxTimelineSeconds, resolveStoryboardTimeline,
  storyboardTimelineDuration, storyboardTimelineEditError,
  type StoryboardTimelineEdit, type StoryboardTimelinePlan, type TimelineAudio, type TimelineCaption, type TimelineTrim,
} from "./storyboard-timeline-data";

export type StoryboardTimelineProps = {
  storyboard: Storyboard;
  images: readonly { url: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTake?: (shotId: string, fileId: string) => void;
  onSave: (edit: StoryboardTimelineEdit) => void;
  onPreview: (plan: StoryboardTimelinePlan) => void | Promise<void>;
  onExport: (plan: StoryboardTimelinePlan) => void | Promise<void>;
};

const audioTypes = [
  { value: "narration", label: "Narration" },
  { value: "music", label: "Music" },
  { value: "effects", label: "Effects" },
] as const;

const feedbackToast = "storyboard-timeline-feedback";

function notifyTimelineError(title: string) {
  toast.add({ id: feedbackToast, title, type: "error", priority: "high" });
}

export function StoryboardTimeline({ open, onOpenChange, ...props }: StoryboardTimelineProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-hidden rounded-3xl p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader className="shrink-0 gap-1 pr-8">
          <DialogTitle>Storyboard timeline</DialogTitle>
          <DialogDescription className="sr-only">Edit video, audio, and subtitles for this storyboard.</DialogDescription>
        </DialogHeader>
        {open && <TimelineEditor {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function TimelineEditor({ storyboard, images, onSelectTake, onSave, onPreview, onExport }: Omit<StoryboardTimelineProps, "open" | "onOpenChange">) {
  const [edit, setEdit] = useState(storyboard.timeline ?? defaultTimeline);
  const [busy, setBusy] = useState(false);
  const [audioId, setAudioId] = useState<string>();
  const [captionIndex, setCaptionIndex] = useState(0);
  const audioInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLTextAreaElement>(null);
  const shots = storyboard.shots ?? [];
  const duration = storyboardTimelineDuration(storyboard, edit);
  const timingError = edit.captions.some(({ text }) => !text.trim())
    ? "Enter text for each subtitle."
    : storyboardTimelineEditError(storyboard, edit);
  const audioIndex = Math.max(0, edit.audio.findIndex(({ fileId }) => fileId === audioId));
  const audio = edit.audio[audioIndex];
  const activeCaption = Math.min(captionIndex, edit.captions.length - 1);
  const caption = edit.captions[activeCaption];
  const captionRange = availableCaptionRange(duration, edit.captions);
  const captionItems = edit.captions.map(({ text }, index) => ({
    value: String(index), label: `Subtitle ${index + 1}${text.trim() ? ` · ${text.trim()}` : ""}`,
  }));

  function updateTrim(trim: TimelineTrim) {
    setEdit((current) => {
      const available = new Set(shots.flatMap((shot) => [
        shot.selectedTakeId, shot.videoId, ...(shot.takes?.map(({ fileId }) => fileId) ?? []),
      ]));
      return { ...current, trims: [...current.trims.filter(({ fileId }) => fileId !== trim.fileId && available.has(fileId)), trim] };
    });
  }

  function updateAudio(index: number, patch: Partial<TimelineAudio>) {
    setEdit((current) => ({ ...current, audio: current.audio.map((track, i) => i === index ? { ...track, ...patch } : track) }));
  }

  function updateCaption(index: number, patch: Partial<TimelineCaption>) {
    setEdit((current) => ({ ...current, captions: current.captions.map((cue, i) => i === index ? { ...cue, ...patch } : cue) }));
  }

  async function addAudio(file: File) {
    setBusy(true);
    try {
      if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("Choose an audio file up to 100 MB.");
      const seconds = await audioDuration(file);
      if (seconds > maxTimelineSeconds) throw new Error("Choose an audio file up to 12 minutes long.");
      const fileId = crypto.randomUUID();
      await storageFile(fileId, file);
      setEdit((current) => ({
        ...current, audio: [...current.audio, { fileId, name: file.name.slice(0, 255), kind: "narration", start: 0, seconds, gain: 1 }],
      }));
      setAudioId(fileId);
    } catch (failure) {
      notifyTimelineError(failure instanceof Error ? failure.message : "Could not import the audio file.");
    } finally {
      setBusy(false);
    }
  }

  function addCaption() {
    if (!captionRange) return;
    setCaptionIndex(edit.captions.length);
    setEdit((current) => ({ ...current, captions: [...current.captions, { ...captionRange, text: "" }] }));
    requestAnimationFrame(() => subtitleInput.current?.focus());
  }

  function saveEdits() {
    if (timingError) return notifyTimelineError(timingError);
    onSave(edit);
    toast.add({ id: feedbackToast, title: "Timeline saved.", type: "success", priority: "low" });
  }

  async function render(callback: StoryboardTimelineProps["onPreview"]) {
    if (timingError) return notifyTimelineError(timingError);
    setBusy(true);
    try {
      const plan = resolveStoryboardTimeline(storyboard, edit);
      onSave(edit);
      await callback(plan);
    } catch (failure) {
      notifyTimelineError(failure instanceof Error ? failure.message : "Could not render the timeline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Tabs defaultValue="video" className="min-h-0 gap-3">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b pb-2">
          <TabsList aria-label="Timeline sections">
            <TabsTrigger value="video"><FilmIcon data-icon="inline-start" />Video</TabsTrigger>
            <TabsTrigger value="audio"><AudioLinesIcon data-icon="inline-start" />Audio</TabsTrigger>
            <TabsTrigger value="subtitles"><CaptionsIcon data-icon="inline-start" />Subtitles</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">{Number.isFinite(duration) && duration >= 0 ? `${duration.toFixed(2)} s` : "—"}</span>
            <Select disabled={busy} value={edit.aspectRatio} onValueChange={(aspectRatio) => {
              if (aspectRatio) setEdit((current) => ({ ...current, aspectRatio }));
            }}>
              <SelectTrigger aria-label="Aspect ratio" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="16:9">16:9</SelectItem><SelectItem value="9:16">9:16</SelectItem></SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value="video" keepMounted className="min-h-0 overflow-y-auto p-0.5">
          <StoryboardVideoTrack shots={shots} images={images} edit={edit} busy={busy} onSelectTake={onSelectTake} onTrim={updateTrim} />
        </TabsContent>

        <TabsContent value="audio" className="min-h-0 space-y-3 overflow-y-auto p-0.5">
          <Input ref={audioInput} type="file" className="hidden" tabIndex={-1} aria-label="Choose audio file"
            accept="audio/*,.m4a,.flac,.ogg,.opus,.wav,.mp3,.aac" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void addAudio(file);
            }} />
          <StoryboardTimedTrack kind="audio" duration={duration} selected={audio?.fileId} disabled={busy} onSelect={setAudioId}
            items={edit.audio.map((track) => ({ id: track.fileId, label: track.name, start: track.start, end: track.start + track.seconds }))}
            action={<Button type="button" variant="secondary" size="sm" disabled={busy || edit.audio.length >= maxTimelineAudio}
              className="bg-zinc-800 text-white hover:bg-zinc-700 hover:text-white" onClick={() => audioInput.current?.click()}>
              <PlusIcon data-icon="inline-start" />Add audio
            </Button>} />
          {audio && <fieldset disabled={busy} className="min-w-0 rounded-xl border px-3 pt-2 pb-3 sm:px-4">
            <legend className="max-w-full truncate px-1.5 text-sm font-medium">{audio.name}</legend>
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="grid gap-1 text-xs font-medium">
                <span>Type</span>
                <Select items={audioTypes} disabled={busy} value={audio.kind} onValueChange={(kind) => { if (kind) updateAudio(audioIndex, { kind }); }}>
                  <SelectTrigger aria-label="Audio type" className="min-w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>{audioTypes.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <NumberInput label="Position (s)" value={audio.start} onChange={(start) => updateAudio(audioIndex, { start })} />
              <NumberInput label="Gain" max={2} value={audio.gain} onChange={(gain) => updateAudio(audioIndex, { gain })} />
              <div className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:ml-auto md:w-auto md:flex-1 md:justify-end">
                <audio key={audio.fileId} controls preload="none" aria-label="Preview source audio" className="h-9 w-full min-w-0 max-w-xs"
                  src={`/api/storage/files/${encodeURIComponent(audio.fileId)}`} />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{audio.seconds.toFixed(2)} s</span>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-destructive md:ml-0"
                aria-label="Remove audio" title="Remove audio" onClick={() => setEdit((current) => ({ ...current, audio: current.audio.filter(({ fileId }) => fileId !== audio.fileId) }))}>
                <Trash2Icon />
              </Button>
            </div>
          </fieldset>}
        </TabsContent>

        <TabsContent value="subtitles" className="min-h-0 space-y-3 overflow-y-auto p-0.5">
          <StoryboardTimedTrack kind="subtitles" duration={duration} selected={String(activeCaption)} disabled={busy}
            onSelect={(id) => setCaptionIndex(Number(id))}
            items={edit.captions.map((cue, index) => ({ id: String(index), label: cue.text.trim() || `Subtitle ${index + 1}`, start: cue.start, end: cue.end }))}
            action={<Button type="button" variant="secondary" size="sm" disabled={busy || !captionRange || edit.captions.length >= maxTimelineCaptions}
              className="bg-zinc-800 text-white hover:bg-zinc-700 hover:text-white" onClick={addCaption}>
              <PlusIcon data-icon="inline-start" />Add subtitle
            </Button>} />
          {caption && <fieldset disabled={busy} className="min-w-0 space-y-2 rounded-xl border px-3 pt-2 pb-3 sm:px-4">
            <legend className="px-1.5 text-sm font-medium">Subtitle {activeCaption + 1}</legend>
            <div className="flex flex-wrap items-end gap-2.5">
              <NumberInput label="Start (s)" value={caption.start} onChange={(start) => updateCaption(activeCaption, { start })} />
              <NumberInput label="End (s)" value={caption.end} onChange={(end) => updateCaption(activeCaption, { end })} />
              {captionItems.length > 1 && <Select items={captionItems} disabled={busy} value={String(activeCaption)}
                onValueChange={(value) => { if (value !== null) setCaptionIndex(Number(value)); }}>
                <SelectTrigger aria-label="Selected subtitle" className="max-w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{captionItems.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>}
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-destructive"
                aria-label="Remove subtitle" title="Remove subtitle" onClick={() => {
                  setCaptionIndex(activeCaption);
                  setEdit((current) => ({ ...current, captions: current.captions.filter((_, index) => index !== activeCaption) }));
                }}>
                <Trash2Icon />
              </Button>
            </div>
            <Textarea ref={subtitleInput} aria-label="Subtitle text" placeholder="Enter subtitle text" value={caption.text}
              maxLength={maxTimelineCaptionLength} rows={2} className="min-h-0 field-sizing-fixed resize-y py-2"
              onChange={(event) => updateCaption(activeCaption, { text: event.target.value })} />
          </fieldset>}
        </TabsContent>
      </Tabs>
      <DialogFooter className="shrink-0 flex-row flex-wrap justify-end border-t pt-3">
        <Button variant="ghost" size="sm" disabled={busy} onClick={saveEdits}>Save edits</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void render(onPreview)}><PlayIcon data-icon="inline-start" />Preview</Button>
        <Button size="sm" disabled={busy} onClick={() => void render(onExport)}><DownloadIcon data-icon="inline-start" />Export MP4</Button>
      </DialogFooter>
    </>
  );
}

function NumberInput({ label, value, onChange, max }: { label: string; value: number; onChange: (value: number) => void; max?: number }) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      {label}
      <Input className="w-24" type="number" min={0} max={max} step="any"
        value={Number.isFinite(value) ? value : ""} onChange={(event) => onChange(event.target.valueAsNumber)} />
    </label>
  );
}

function availableCaptionRange(duration: number, captions: TimelineCaption[]) {
  if (!Number.isFinite(duration) || duration < 0.001) return;
  const sorted = captions.filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left.start - right.start);
  const tail = Math.max(0, ...sorted.map(({ end }) => end));
  if (duration - tail >= 0.001) return { start: tail, end: Math.min(tail + 2, duration) };
  let start = 0;
  for (const cue of sorted) {
    const end = Math.min(cue.start, duration, start + 2);
    if (end - start >= 0.001) return { start, end };
    start = Math.max(start, cue.end);
  }
}

async function audioDuration(file: File) {
  const url = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  try {
    return await new Promise<number>((resolve, reject) => {
      const error = new Error("Could not read the duration of this audio file.");
      const timeout = window.setTimeout(() => reject(error), 10_000);
      audio.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        if (Number.isFinite(audio.duration) && audio.duration > 0) resolve(audio.duration);
        else reject(error);
      };
      audio.onerror = () => { window.clearTimeout(timeout); reject(error); };
      audio.preload = "metadata";
      audio.src = url;
    });
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
