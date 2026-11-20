import type { DesktopAgentApi, DesktopSdApi, DesktopVideoApi } from "@/lib/desktop";
import {
  browserImageModel,
  geminiImageModel,
  geminiVideoModel,
  isSdModel,
  modelProvider,
  videoStartImage,
} from "./generation";
import type { Shot, Storyboard } from "./storyboard-data";
import { matchingShotTakeJob, selectedShotTake } from "./storyboard-takes";
import { storyboardTimelineEditError } from "./storyboard-timeline-data";

export type PreflightImage = { url: string; name?: string };

export type StoryboardPreflightBlocker = {
  shotIndex?: number;
  message: string;
};

export type StoryboardPreflightOptions = {
  story: Storyboard;
  videoModel: string;
  pictureModel?: string;
  keys?: Record<string, string | undefined>;
  storyImages?: readonly PreflightImage[];
  desktopVideo?: DesktopVideoApi | null;
  desktopAgents?: DesktopAgentApi | null;
  desktopSd?: DesktopSdApi | null;
  storageFile?: (id: string) => Promise<Blob | undefined>;
};

export type StoryboardPreflightResult = {
  ok: boolean;
  blockers: StoryboardPreflightBlocker[];
  clips: number;
  resumes: number;
  stale: number;
  pictures: number;
  toolBytes: number;
};

const maxClipBytes = 100 * 1024 * 1024;

export async function preflightStoryboardVideo({
  story,
  videoModel,
  pictureModel = "",
  keys,
  storyImages = [],
  desktopVideo,
  desktopAgents,
  desktopSd,
  storageFile,
}: StoryboardPreflightOptions): Promise<StoryboardPreflightResult> {
  const blockers: StoryboardPreflightBlocker[] = [];
  const shots = story.shots ?? [];

  if (shots.length === 0) {
    return {
      ok: false,
      blockers: [{ message: "Add at least one shot before making the video." }],
      clips: 0,
      resumes: 0,
      stale: 0,
      pictures: 0,
      toolBytes: 0,
    };
  }

  // 1. Timeline checks
  if (story.timeline) {
    const timelineError = storyboardTimelineEditError(story, story.timeline);
    if (timelineError) {
      blockers.push({ message: timelineError });
    }
  }

  // 2. Desktop Video Tool / Bridge check
  let toolBytes = 0;
  if (!desktopVideo) {
    blockers.push({ message: "Joining clips into one video needs the Lomra desktop app." });
  } else {
    try {
      const tool = await desktopVideo.status();
      if (!tool.supported) {
        blockers.push({ message: "Joining clips into one video is not available on this computer yet." });
      } else if (!tool.installed) {
        toolBytes = tool.bytes;
      }
    } catch {
      blockers.push({ message: "Could not reach the video tool." });
    }
  }

  // 3. Categorize shots (finished vs missing)
  const missingTakes: { index: number; shot: Shot }[] = [];
  let resumes = 0;
  let stale = 0;

  for (const [index, shot] of shots.entries()) {
    const take = selectedShotTake(shot);
    if (take) {
      if (take.stale) stale++;
      if (storageFile && take.fileId) {
        let blob: Blob | undefined;
        try {
          blob = await storageFile(take.fileId);
        } catch {
          // Treated as unreadable/missing
        }
        if (!blob || blob.size === 0) {
          blockers.push({
            shotIndex: index,
            message: `Shot ${index + 1} video clip is missing from local storage.`,
          });
        } else if (blob.size > maxClipBytes) {
          blockers.push({
            shotIndex: index,
            message: `Shot ${index + 1} video clip exceeds the 100 MB file limit.`,
          });
        }
      }
    } else {
      missingTakes.push({ index, shot });
    }
  }

  // 4. Video model checks (only if some takes need generating or resuming)
  if (missingTakes.length > 0) {
    if (!videoModel) {
      blockers.push({ message: "Select a video model in the prompt toolbar first." });
    } else if (!videoStartImage(videoModel)) {
      blockers.push({
        message: "This video model cannot start from a picture. Choose Gemini Omni, Gemini Create video or an OpenRouter video model.",
      });
    } else {
      if (videoModel === geminiVideoModel) {
        if (!desktopAgents?.browserGemini) {
          blockers.push({ message: "Gemini video generation requires an up-to-date Lomra desktop app." });
        }
      } else if (modelProvider(videoModel) === "openrouter") {
        if (!keys?.openrouter?.trim()) {
          blockers.push({ message: "Enter your OpenRouter API key in Settings to generate video clips." });
        }
      } else if (modelProvider(videoModel) === "google") {
        if (!keys?.google?.trim()) {
          blockers.push({ message: "Enter your Google API key in Settings to generate video clips." });
        }
      }
    }
  }

  // 5. Per-shot validation for missing takes
  let pictures = 0;
  const shotsNeedingImageDraw: { index: number; shot: Shot }[] = [];

  for (const { index, shot } of missingTakes) {
    if (shot.pendingTake && !matchingShotTakeJob(shot, videoModel, story.timeline?.aspectRatio)) {
      blockers.push({
        shotIndex: index,
        message: `Open Shot ${index + 1} settings and check its saved job before making the video.`,
      });
      continue;
    }

    const isResumable = !!matchingShotTakeJob(shot, videoModel, story.timeline?.aspectRatio);
    if (isResumable) {
      resumes++;
      continue;
    }

    if (shot.image === null && !shot.generatedId) {
      pictures++;
      if (!shot.description.trim()) {
        blockers.push({
          shotIndex: index,
          message: `Shot ${index + 1} needs an image or a description.`,
        });
      } else {
        shotsNeedingImageDraw.push({ index, shot });
      }
    } else if (shot.generatedId) {
      if (storageFile) {
        let blob: Blob | undefined;
        try {
          blob = await storageFile(shot.generatedId);
        } catch {
          // Treated as unreadable/missing
        }
        if (!blob || blob.size === 0) {
          blockers.push({
            shotIndex: index,
            message: `Shot ${index + 1} image is missing from local storage.`,
          });
        }
      }
    } else if (shot.image !== null) {
      const img = storyImages[shot.image];
      if (!img || !img.url) {
        blockers.push({
          shotIndex: index,
          message: `Shot ${index + 1} referenced canvas image is missing.`,
        });
      }
    }
  }

  // 6. Picture model and reference validation (if any shots need to draw an image)
  if (shotsNeedingImageDraw.length > 0) {
    if (!pictureModel) {
      blockers.push({ message: "Select an image model in the prompt toolbar first." });
    } else {
      if (isSdModel(pictureModel)) {
        if (!desktopSd) {
          blockers.push({ message: "Local image models require the Lomra desktop app." });
        }
      } else if (pictureModel === browserImageModel) {
        if (!desktopAgents?.browserImage) {
          blockers.push({ message: "ChatGPT images require an up-to-date Lomra desktop app." });
        }
      } else if (pictureModel === geminiImageModel) {
        if (!desktopAgents?.browserGemini) {
          blockers.push({ message: "Gemini generation requires an up-to-date Lomra desktop app." });
        }
      } else if (modelProvider(pictureModel) === "openrouter") {
        if (!keys?.openrouter?.trim()) {
          blockers.push({ message: "Enter your OpenRouter API key in Settings to generate shot images." });
        }
      } else if (modelProvider(pictureModel) === "google") {
        if (!keys?.google?.trim()) {
          blockers.push({ message: "Enter your Google API key in Settings to generate shot images." });
        }
      }

      for (const { index, shot } of shotsNeedingImageDraw) {
        for (const charIndex of shot.characters ?? []) {
          const character = story.characters?.[charIndex];
          if (character) {
            if (character.approved && character.generatedId && storageFile) {
              let blob: Blob | undefined;
              try {
                blob = await storageFile(character.generatedId);
              } catch {
                // Treated as missing
              }
              if (!blob || blob.size === 0) {
                blockers.push({
                  shotIndex: index,
                  message: `Shot ${index + 1} character reference for "${character.name}" is missing from local storage.`,
                });
              }
            } else if (character.image !== null) {
              const charImg = storyImages[character.image];
              if (!charImg || !charImg.url) {
                blockers.push({
                  shotIndex: index,
                  message: `Shot ${index + 1} character reference image for "${character.name}" is missing.`,
                });
              }
            }
          }
        }

        for (const refIndex of shot.references ?? []) {
          const refImg = storyImages[refIndex];
          if (!refImg || !refImg.url) {
            blockers.push({
              shotIndex: index,
              message: `Shot ${index + 1} reference image is missing.`,
            });
          }
        }
      }
    }
  }

  // 7. Timeline audio tracks check
  if (story.timeline?.audio && storageFile) {
    for (const [trackIndex, track] of story.timeline.audio.entries()) {
      if (track.fileId) {
        let blob: Blob | undefined;
        try {
          blob = await storageFile(track.fileId);
        } catch {
          // Treated as missing
        }
        if (!blob || blob.size === 0) {
          blockers.push({
            message: `Audio track ${trackIndex + 1} is missing from local storage.`,
          });
        }
      }
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    clips: missingTakes.length - resumes,
    resumes,
    stale,
    pictures,
    toolBytes,
  };
}
