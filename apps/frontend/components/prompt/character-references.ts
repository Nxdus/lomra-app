import { mentionedCharacters, type Character } from "@/lib/characters";
import { storage, storageFile } from "@/lib/storage";
import { geminiVideoModel, isSdModel, modelProvider, type Generation } from "./generation";
import { imagePreview, MAX_MEDIA_BYTES, MAX_MEDIA_ITEMS, promptContent } from "./media";

export async function listCharacters(): Promise<Character[]> {
  const rows: { value: Character }[] = await storage("characters");
  return rows.map(({ value }) => value).sort((a, b) => a.name.localeCompare(b.name));
}

type Reference = { character: Character; url: string };

export async function loadCharacterReferences(prompt: string, signal: AbortSignal, previews = false): Promise<Reference[]> {
  if (!prompt.includes("@")) return [];
  const characters = mentionedCharacters(prompt, await listCharacters());
  if (characters.length > MAX_MEDIA_ITEMS) throw new Error(`Use at most ${MAX_MEDIA_ITEMS} Characters per prompt.`);
  if (!characters.length) return [];
  const sources = await Promise.all(characters.map(async (character) => {
    const blob = await storageFile(character.id).catch(() => undefined);
    if (!blob) throw new Error(`Could not load the reference for @${character.name}. Try again or save a new Character.`);
    return { id: character.id, file: new File([blob], character.name, { type: character.imageType }) };
  }));
  if (previews) return Promise.all(sources.map(async ({ file }, index) => ({ character: characters[index], url: await imagePreview(file, signal) })));
  const content = await promptContent("", sources, signal);
  const images = typeof content === "string" ? [] : content.filter((part) => part.type === "image_url");
  return characters.map((character, index) => ({ character, url: images[index].image_url.url }));
}

export function characterContext(references: Reference[], includeNotes = true) {
  if (!references.length) return "";
  return "\n\nMentioned Characters (appearance defaults can be changed for the current scene):\n" +
    references.map(({ character }) => `@${character.name}${includeNotes && character.notes ? `: ${character.notes}` : ""}`).join("\n");
}

export function characterGeneration(task: Generation, images: string[], references: Reference[]) {
  if (!references.length || task.mediaTool || task.operation) return { task, images };
  const prompt = task.prompt + characterContext(references);
  if (prompt.length > 8000) throw new Error("The prompt and Character notes are too long. Use a shorter prompt or fewer Characters.");
  if (task.category === "3d") throw new Error("To create 3D, select the reference image on the canvas and remove the @Character tag.");
  if (task.category === "video") {
    if (task.model !== geminiVideoModel) throw new Error("Choose Gemini Browser video to use a Character or a scene image as the first frame.");
    if (images.length > 1 || (!images.length && references.length > 1)) {
      throw new Error("For video with multiple images or Characters, select one scene image as the first frame.");
    }
    return { task: { ...task, prompt }, images: images.length ? images : [references[0].url] };
  }
  if (isSdModel(task.model) || modelProvider(task.model) === "google") {
    throw new Error("The selected image model cannot use Character references. Choose a model that supports reference images.");
  }
  const allImages = [...images];
  const labels = references.map(({ character, url }) => {
    const index = allImages.indexOf(url);
    const number = index < 0 ? allImages.push(url) : index + 1;
    return `Image ${number} is @${character.name}.`;
  });
  if (allImages.length > MAX_MEDIA_ITEMS || allImages.reduce((size, url) => size + url.length, 0) > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + MAX_MEDIA_ITEMS * 64) {
    throw new Error("The combined images exceed the prompt limit. Use fewer or smaller images.");
  }
  const imagePrompt = prompt + "\n" + labels.join("\n");
  if (imagePrompt.length > 8000) throw new Error("The prompt and Character notes are too long. Use a shorter prompt or fewer Characters.");
  return { task: { ...task, prompt: imagePrompt }, images: allImages };
}
