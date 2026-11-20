import { generate, isBrowserModel, videoStartImage, type GeneratedFile, type Generation } from "./generation";
import { maxShotTakes, type PendingShotTake, type Shot, type ShotTake, type ShotTakeSource } from "./storyboard-data";

export function shotTakeSource(shot: Shot): ShotTakeSource {
  const details = [
    ["Scene", shot.scene], ["Dialogue", shot.dialogue], ["Sound", shot.sound], ["Camera", shot.camera],
  ].flatMap(([label, value]) => value?.trim() ? [`\n${label}: ${value.trim()}`] : []);
  return {
    frame: shot.generatedId ? `file:${shot.generatedId}` : shot.image === null ? null : `image:${shot.image}`,
    prompt: `${shot.description.trim()}${details.join("")}\n\nAnimate this shot from the starting image with natural, subtle motion and camera movement. Keep the characters and the setting exactly as in the image. No text or subtitles.`,
  };
}

function sameSource(a: ShotTakeSource, b: ShotTakeSource) {
  return a.frame === b.frame && a.prompt === b.prompt;
}

// Call before applying a shot edit so a legacy clip keeps its original source.
export function normalizeShotTakes(shot: Shot): Shot {
  if (shot.takes?.length || !shot.videoId) return shot;
  return {
    ...shot,
    takes: [{ fileId: shot.videoId, source: shotTakeSource(shot) }],
    selectedTakeId: shot.videoId,
  };
}

export function shotTakes(shot: Shot) {
  const normalized = normalizeShotTakes(shot);
  const source = shotTakeSource(shot);
  return (normalized.takes ?? []).map((take) => ({
    ...take,
    stale: !sameSource(take.source, source),
    selected: (normalized.selectedTakeId ?? normalized.videoId) === take.fileId,
  }));
}

export function selectedShotTake(shot: Shot) {
  return shotTakes(shot).find((take) => take.selected);
}

export function selectShotTake(shot: Shot, fileId: string): Shot {
  const normalized = normalizeShotTakes(shot);
  return normalized.takes?.some((take) => take.fileId === fileId)
    ? { ...normalized, selectedTakeId: fileId, videoId: fileId }
    : shot;
}

export function matchingShotTakeJob(shot: Shot, model: string, aspectRatio = "16:9") {
  const job = shot.pendingTake;
  return job?.model === model && job.aspectRatio === aspectRatio &&
    sameSource(job.source, shotTakeSource(shot)) ? job : undefined;
}

type GenerateShotTakeOptions = {
  shot: Shot;
  model: string;
  aspectRatio?: string;
  resume?: boolean;
  request: Parameters<typeof generate>[1];
  signal: AbortSignal;
  loadPicture: (shot: Shot, signal: AbortSignal) => Promise<string>;
  saveFile: (file: GeneratedFile, signal: AbortSignal) => Promise<string>;
  updateShot: (id: string, update: (current: Shot) => Shot) => void;
  onStatus?: (status: string) => void;
};

const activeShots = new Set<string>();

// Call after confirming a new submission. A matching saved request or explicit resume only polls.
export async function generateShotTake({
  shot, model: selectedModel, aspectRatio: selectedAspectRatio = "16:9", resume, request, signal, loadPicture, saveFile, updateShot, onStatus,
}: GenerateShotTakeOptions): Promise<ShotTake> {
  const id = shot.id;
  if (!id) throw new Error("The shot needs an ID before making a take.");
  if (activeShots.has(id)) throw new Error("A take is already running for this shot.");
  let job = resume ? shot.pendingTake : matchingShotTakeJob(shot, selectedModel, selectedAspectRatio);
  if (resume && !job) throw new Error("There is no saved job to check.");
  if (shot.pendingTake && !job) throw new Error("Check the saved job before generating another take.");
  const source = job?.source ?? shotTakeSource(shot);
  const model = job?.model ?? selectedModel;
  const aspectRatio = job?.aspectRatio ?? selectedAspectRatio;
  if (job && isBrowserModel(model)) throw new Error("This browser model cannot check saved jobs.");
  if (!job && !source.frame) throw new Error("Add a first frame before making a take.");
  if (!job && (!model || !videoStartImage(model))) throw new Error("Choose a video model that supports a first frame.");
  let submitted = false;
  let terminal = false;
  let files: GeneratedFile[] = [];
  activeShots.add(id);
  try {
    signal.throwIfAborted();
    const images = job ? [] : [await loadPicture(shot, signal)];
    const task: Generation = {
      id: crypto.randomUUID(), category: "video", model, status: "Waiting", prompt: source.prompt,
      aspectRatio, startImage: true, requestId: job?.requestId,
    };
    submitted = isBrowserModel(model);
    files = await generate(task, async (provider, options) => {
      if (options.action === "video") submitted = true;
      const response = await request(provider, options);
      if (options.action === "video-status") {
        const status = (response as { status?: string } | null)?.status?.toLowerCase();
        terminal = status === "failed" || status === "cancelled" || status === "expired";
      }
      return response;
    }, signal, ({ requestId, status }) => {
      if (requestId && !job) {
        const pending: PendingShotTake = { requestId, source, model, aspectRatio };
        job = pending;
        updateShot(id, (current) => ({ ...normalizeShotTakes(current), pendingTake: pending }));
      }
      if (status) onStatus?.(status);
    }, images[0], images);
    signal.throwIfAborted();
    const file = files.find((item) => item.kind === "video");
    if (!file) throw new Error("The video model did not return a video.");
    const take = { fileId: await saveFile(file, signal), source, model };
    updateShot(id, (current) => {
      const normalized = normalizeShotTakes(current);
      const takes = [...(normalized.takes ?? []).filter(({ fileId }) => fileId !== take.fileId), take].slice(-maxShotTakes);
      return {
        ...normalized, takes, selectedTakeId: take.fileId, videoId: take.fileId,
        pendingTake: normalized.pendingTake?.requestId === job?.requestId ? undefined : normalized.pendingTake,
      };
    });
    return take;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job && terminal) {
      updateShot(id, (current) => current.pendingTake?.requestId === job?.requestId ? { ...current, pendingTake: undefined } : current);
      throw error;
    }
    if (job) throw new Error(`${message} Check job to resume without another submission.`, { cause: error });
    if (submitted) throw new Error(`${message} No resumable job ID was received. Check the provider before retrying because retrying starts a new generation.`, { cause: error });
    throw error;
  } finally {
    for (const { url } of files) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    activeShots.delete(id);
  }
}
