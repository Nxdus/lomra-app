import { characterNameKey, characterNotesLimit } from "@/lib/characters";

export type Shot = {
  description: string;
  seconds: number;
  image: number | null;
  references: number[];
  generatedId?: string;
  // The clip made from this shot's picture (a workspace file), joined with the others into the final video.
  videoId?: string;
  characters?: number[];
  position?: { x: number; y: number };
};

export type StoryCharacter = { name: string; notes: string; image: number | null; generatedId?: string; approved?: boolean };
// origin: where the storyboard sits on the canvas, fixed once shown so other pictures cannot push it around.
export type Storyboard = { story: string; shots?: Shot[]; characters?: StoryCharacter[]; origin?: { x: number; y: number }; videoItemId?: string };

export const storyLimit = 6000;
export const shotLimit = 1600;
const maxShots = 12;
export const maxStoryCharacters = 8;
export const storyCharacterNotesLimit = characterNotesLimit;

export function mergeStoryCharacters(current: StoryCharacter[], incoming: StoryCharacter[]) {
  const merged = [...current];
  for (const character of incoming) {
    const index = merged.findIndex(({ name }) => characterNameKey(name.trim()) === characterNameKey(character.name));
    if (index < 0 && merged.length < maxStoryCharacters) merged.push(character);
    if (index >= 0 && merged[index].image === null && !merged[index].generatedId && character.image !== null) {
      merged[index] = { ...merged[index], image: character.image };
    }
  }
  return merged;
}

export function shotImagePrompt(description: string, story: string, cast: string[]) {
  const instruction = "Create one standalone storyboard frame. Use a single composition without captions or panels.";
  const visual = `${instruction}\nShot: ${description.trim()}${cast.length ? "\nKeep these character details consistent:\n" + cast.join("\n") : ""}`;
  if (visual.length > 8000) throw new Error("Shorten the shot description or Character notes before generating.");
  const contextLabel = "\nStory context: ";
  const remaining = 8000 - visual.length - contextLabel.length;
  return remaining > 0 ? visual + contextLabel + story.slice(0, remaining) : visual;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

export function validStoryboard(value: unknown, imageCount: number): value is Storyboard {
  if (!record(value) || !boundedText(value.story, storyLimit)) return false;
  const inRange = (index: unknown, count: number) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < count;
  const indices = (items: unknown, count: number) => Array.isArray(items) && items.length <= count &&
    items.every((index) => inRange(index, count)) && new Set(items).size === items.length;
  const fileId = (id: unknown) => typeof id === "string" && /^[\w-]{1,128}$/.test(id);
  const characters = value.characters;
  if (value.videoItemId !== undefined && !fileId(value.videoItemId)) return false;
  if (value.origin !== undefined && !(record(value.origin) && [value.origin.x, value.origin.y].every((axis) => typeof axis === "number" && Number.isFinite(axis) && Math.abs(axis) <= 1e9))) return false;
  if (characters !== undefined && (!Array.isArray(characters) || characters.length > maxStoryCharacters ||
    !characters.every((item: unknown) => record(item) && boundedText(item.name, 64) &&
      boundedText(item.notes, storyCharacterNotesLimit) && (item.image === null || inRange(item.image, imageCount)) &&
      (item.generatedId === undefined || fileId(item.generatedId)) &&
      (item.approved === undefined || (typeof item.approved === "boolean" && fileId(item.generatedId)))))) return false;
  return (
    (value.shots === undefined || (Array.isArray(value.shots) && value.shots.length > 0 && value.shots.length <= maxShots &&
      value.shots.every((shot: unknown) => record(shot) && boundedText(shot.description, shotLimit) &&
        typeof shot.seconds === "number" && shot.seconds >= 1 && shot.seconds <= 60 &&
        (shot.image === null || inRange(shot.image, imageCount)) && indices(shot.references, imageCount) &&
        (shot.characters === undefined || indices(shot.characters, characters?.length ?? 0)) &&
        (shot.generatedId === undefined || fileId(shot.generatedId)) &&
        (shot.videoId === undefined || fileId(shot.videoId)) &&
        (shot.position === undefined || (record(shot.position) && [shot.position.x, shot.position.y].every((axis) => typeof axis === "number" && Number.isFinite(axis) && Math.abs(axis) <= 1e9)))))));
}

function responseObject(result: unknown): unknown {
  const content = (result as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("The LLM returned no text. Try another model.");
  const json = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  // Agent CLIs may wrap the object in a sentence, so fall back to the outermost braces.
  const start = json.indexOf("{"), end = json.lastIndexOf("}");
  for (const candidate of [json, start >= 0 && end > start ? json.slice(start, end + 1) : ""]) {
    try { return JSON.parse(candidate); } catch { /* try the next candidate */ }
  }
  throw new Error("The LLM returned invalid storyboard JSON. Try again or choose another model.");
}

export function storyReply(result: unknown, imageCount = 0) {
  const value = responseObject(result);
  if (!record(value) || !boundedText(value.reply, 4000) || !value.reply.trim() ||
    !boundedText(value.story, storyLimit) || !value.story.trim()) {
    throw new Error("The LLM did not return a story draft. Try again or choose another model.");
  }
  const characters = Array.isArray(value.characters) ? value.characters.flatMap((item: unknown): StoryCharacter[] => {
    if (!record(item) || typeof item.name !== "string" || !item.name.trim() || typeof item.notes !== "string") return [];
    const image = typeof item.image === "number" && Number.isInteger(item.image) && item.image >= 0 && item.image < imageCount ? item.image : null;
    return [{ name: item.name.trim().slice(0, 64), notes: item.notes.trim().slice(0, storyCharacterNotesLimit), image }];
  }).slice(0, maxStoryCharacters) : [];
  return { reply: value.reply.trim(), story: value.story.trim(), characters };
}

export function draftedShots(result: unknown, imageCount: number, characters: StoryCharacter[] = []) {
  const value = responseObject(result);
  const shots = record(value) && Array.isArray(value.shots) ? value.shots.map((shot: unknown) => record(shot)
    ? { description: shot.description, seconds: shot.seconds, image: shot.image, references: shot.references,
      ...(shot.characters !== undefined && { characters: shot.characters }) }
    : shot) : null;
  const draft: unknown = { story: "", shots, characters };
  if (!validStoryboard(draft, imageCount) || !draft.shots?.every((shot) => shot.description.trim())) {
    throw new Error("The LLM returned invalid shots or image references. Try drafting the shots again.");
  }
  return draft.shots;
}

export const draftStoryInstruction = `Help the user refine a story for a storyboard. Read the selected images as possible visual references. Follow the user's direction and answer in their language. Return only JSON with reply (brief feedback, at most 4000 characters), story (the full revised synopsis, at most 6000 characters), and characters (up to ${maxStoryCharacters} distinct recurring characters, each with name, notes describing consistent appearance and clothing, and image as the zero-based selected image index or null if none depicts them). Always provide a usable draft. List only new characters when a cast already exists.`;
export const draftShotsInstruction = `Turn the user-approved story into up to ${maxShots} ordered storyboard shots. Return only JSON in the form {"shots":[{"description":"...","seconds":4,"image":null,"references":[],"characters":[]}]}. Write each visual description in the user's language (max ${shotLimit} characters), including action, camera, and relevant appearance. Use durations of 1 to 60 seconds. Use a selected image's zero-based index as image only when it works as the shot itself. Otherwise use null. List distinct zero-based selected-image indices in references for relevant locations, props or style. In characters, list distinct zero-based indices from the supplied cast for characters visible in that shot. Use empty arrays when no references or characters apply.`;
