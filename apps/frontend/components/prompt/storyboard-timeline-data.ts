import type { DesktopVideoApi } from "@/lib/desktop";
import type { Shot, Storyboard } from "./storyboard-data";

export const maxTimelineAudio = 8;
export const maxTimelineCaptions = 100;
export const maxTimelineCaptionLength = 2000;
export const maxTimelineSeconds = 12 * 60;
const maxFileBytes = 100 * 1024 * 1024;
const maxTotalBytes = 600 * 1024 * 1024;
const timingTolerance = 1e-8;

export type TimelineTrim = { fileId: string; start: number; end: number; mute: boolean };
export type TimelineAudio = {
  fileId: string;
  name: string;
  kind: "narration" | "music" | "effects";
  start: number;
  seconds: number;
  gain: number;
};
export type TimelineCaption = { start: number; end: number; text: string };
export type StoryboardTimelineEdit = {
  aspectRatio: "16:9" | "9:16";
  trims: TimelineTrim[];
  audio: TimelineAudio[];
  captions: TimelineCaption[];
};

export const defaultTimeline: StoryboardTimelineEdit = { aspectRatio: "16:9", trims: [], audio: [], captions: [] };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fileId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,128}$/.test(value);
}

function between(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validEditFields(value: unknown): value is StoryboardTimelineEdit {
  return record(value) && (value.aspectRatio === "16:9" || value.aspectRatio === "9:16") &&
    Array.isArray(value.trims) && value.trims.length <= 96 && value.trims.every((trim: unknown) =>
      record(trim) && fileId(trim.fileId) && between(trim.start, 0, Infinity) && typeof trim.end === "number" &&
      between(trim.end - trim.start, 1 - timingTolerance, 60 + timingTolerance) && typeof trim.mute === "boolean") &&
    new Set(value.trims.map(({ fileId }) => fileId)).size === value.trims.length &&
    Array.isArray(value.audio) && value.audio.length <= maxTimelineAudio && value.audio.every((audio: unknown) =>
      record(audio) && fileId(audio.fileId) && typeof audio.name === "string" && audio.name.length <= 255 &&
      (audio.kind === "narration" || audio.kind === "music" || audio.kind === "effects") &&
      between(audio.start, 0, maxTimelineSeconds) && between(audio.seconds, Number.MIN_VALUE, maxTimelineSeconds) &&
      between(audio.gain, 0, 2)) &&
    new Set(value.audio.map(({ fileId }) => fileId)).size === value.audio.length &&
    Array.isArray(value.captions) && value.captions.length <= maxTimelineCaptions && value.captions.every((cue: unknown) =>
      record(cue) && between(cue.start, 0, maxTimelineSeconds) && between(cue.end, 0, maxTimelineSeconds) &&
      milliseconds(cue.end) > milliseconds(cue.start) && typeof cue.text === "string" &&
      cue.text.length <= maxTimelineCaptionLength && !!cue.text.replace(/[\p{Cc}\s]/gu, "").trim());
}

function milliseconds(seconds: number) {
  return Number(seconds.toFixed(3));
}

function orderedCaptions(captions: TimelineCaption[]) {
  return [...captions].sort((a, b) => a.start - b.start);
}

function captionsOverlap(captions: TimelineCaption[]) {
  return orderedCaptions(captions).some(({ start }, index, ordered) => index > 0 && start < ordered[index - 1].end);
}

export function validStoryboardTimeline(value: unknown): value is StoryboardTimelineEdit {
  return validEditFields(value) && !captionsOverlap(value.captions);
}

export function timelineShotClip(shot: Shot, edit: StoryboardTimelineEdit) {
  const fileId = shot.selectedTakeId ?? shot.videoId;
  const trim = fileId ? edit.trims.find((item) => item.fileId === fileId) : undefined;
  return { fileId, start: trim?.start ?? 0, end: trim?.end ?? shot.seconds, mute: trim?.mute ?? false };
}

export function storyboardTimelineDuration(board: Storyboard, edit: StoryboardTimelineEdit) {
  return milliseconds((board.shots ?? []).reduce((total, shot) => {
    const { start, end } = timelineShotClip(shot, edit);
    return total + milliseconds(end - start);
  }, 0));
}

export function storyboardTimelineEditError(board: Storyboard, edit: StoryboardTimelineEdit) {
  if (!validEditFields(edit)) {
    return "Check trim ranges (1–60 seconds per shot), audio timing and gain (0–2), and subtitle text and timing.";
  }
  const duration = storyboardTimelineDuration(board, edit);
  if (edit.audio.some(({ start, seconds }) => start >= duration || start + seconds > duration + timingTolerance)) {
    return "An audio track extends beyond the video duration. Move it earlier or choose a shorter file.";
  }
  if (edit.captions.some(({ end }) => milliseconds(end) > duration)) return "A subtitle extends beyond the video duration.";
  if (captionsOverlap(edit.captions)) return "Subtitle timings overlap.";
}

export function resolveStoryboardTimeline(board: Storyboard, edit = board.timeline ?? defaultTimeline) {
  const error = storyboardTimelineEditError(board, edit);
  if (error) throw new Error(error);
  if (!board.shots?.length) throw new Error("Add a shot before rendering.");
  const clips = board.shots.map((shot, index) => {
    const { fileId: id, start, end, mute } = timelineShotClip(shot, edit);
    if (!fileId(id)) throw new Error(`Select a video take for shot ${index + 1}.`);
    return { fileId: id, start, seconds: milliseconds(end - start), mute };
  });
  return {
    aspectRatio: edit.aspectRatio,
    clips,
    audio: edit.audio.map(({ fileId, start, gain }) => ({ fileId, start, gain })),
    captions: orderedCaptions(edit.captions).map(({ start, end, text }) => ({
      start: milliseconds(start), end: milliseconds(end), text: text.trim(),
    })),
  };
}

export type StoryboardTimelinePlan = ReturnType<typeof resolveStoryboardTimeline>;

export async function storyboardTimelineRenderInput(
  plan: StoryboardTimelinePlan,
  loadFile: (id: string) => Promise<Blob | undefined>,
): Promise<Parameters<DesktopVideoApi["stitch"]>[1]> {
  let totalBytes = 0;
  async function read(id: string, label: string) {
    if (!fileId(id)) throw new Error(`${label} has an invalid local file ID.`);
    let blob: Blob | undefined;
    try { blob = await loadFile(id); } catch { /* handled as unreadable below */ }
    if (!blob?.size) throw new Error(`${label} is missing or unreadable.`);
    if (blob.size > maxFileBytes) throw new Error(`${label} exceeds the 100 MB file limit.`);
    totalBytes += blob.size;
    if (totalBytes > maxTotalBytes) throw new Error("The timeline media exceeds the 600 MB render limit.");
    try { return new Uint8Array(await blob.arrayBuffer()); }
    catch { throw new Error(`${label} is unreadable.`); }
  }

  const clips = [];
  for (const [index, { fileId, ...clip }] of plan.clips.entries()) {
    clips.push({ ...clip, data: await read(fileId, `Shot ${index + 1} video`) });
  }
  const audio = [];
  for (const [index, { fileId, ...track }] of plan.audio.entries()) {
    audio.push({ ...track, data: await read(fileId, `Audio track ${index + 1}`) });
  }
  return { aspectRatio: plan.aspectRatio, clips, audio, captions: plan.captions };
}
