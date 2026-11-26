import { characterImageId, mentionedCharacters, type Character } from "@/lib/characters";
import type { SdStatus } from "@/lib/desktop";
import { pictureCapabilities } from "@/lib/picture-capabilities";
import { storage, storageFile } from "@/lib/storage";
import { geminiVideoModel, type Generation } from "./generation";
import { imagePreview, MAX_MEDIA_BYTES, MAX_MEDIA_ITEMS, promptContent } from "./media";

export async function listCharacters(): Promise<Character[]> {
  const rows: { value: Character }[] = await storage("characters");
  return rows.map(({ value }) => value).sort((a, b) => a.name.localeCompare(b.name));
}

type Reference = { character: Character; url: string; additionalUrls?: string[] };

export async function loadCharacterReferences(prompt: string, signal: AbortSignal, previews = false): Promise<Reference[]> {
  if (!prompt.includes("@")) return [];
  const characters = mentionedCharacters(prompt, await listCharacters());
  if (!characters.length) return [];
  const groups = characters.map(character => {
    const images = [character.imageType, ...(character.additionalImageTypes ?? [])]
      .map((type, index) => ({ id: characterImageId(character.id, index), type, character }));
    const [cover] = images.splice(character.coverIndex ?? 0, 1);
    return previews ? [cover] : [cover, ...images];
  });
  const files = groups.flat();
  if (files.length > MAX_MEDIA_ITEMS) throw new Error(`Use at most ${MAX_MEDIA_ITEMS} Character reference images per prompt.`);
  const sources = await Promise.all(files.map(async ({ id, type, character }) => {
    const blob = await storageFile(id).catch(() => undefined);
    if (!blob) throw new Error(`Could not load the reference for @${character.name}. Try again or save a new Character.`);
    return { id, file: new File([blob], character.name, { type }) };
  }));
  if (previews) return Promise.all(sources.map(async ({ file }, index) => ({ character: characters[index], url: await imagePreview(file, signal) })));
  const content = await promptContent("", sources, signal);
  const urls = typeof content === "string" ? [] : content.filter(part => part.type === "image_url").map(part => part.image_url.url);
  return groups.map(group => {
    const [url, ...additionalUrls] = urls.splice(0, group.length);
    return { character: group[0].character, url, additionalUrls };
  });
}

export function characterContext(references: Reference[], includeNotes = true) {
  if (!references.length) return "";
  return "\n\nMentioned Characters (appearance defaults can be changed for the current scene):\n" +
    references.map(({ character }) => `@${character.name}${includeNotes && character.notes ? `: ${character.notes}` : ""}`).join("\n");
}

export function characterGeneration(task: Generation, images: string[], references: Reference[], sdStatus?: SdStatus | null) {
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
  if (!pictureCapabilities(task.model, sdStatus).referencePictures) {
    throw new Error("The selected image model cannot use Character references. Choose a model that supports reference images.");
  }
  const allImages = [...images];
  const labels = references.flatMap(({ character, url, additionalUrls = [] }) =>
    [...new Set([url, ...additionalUrls])].map(referenceUrl => {
      const index = allImages.indexOf(referenceUrl);
      const number = index < 0 ? allImages.push(referenceUrl) : index + 1;
      return `Image ${number} is @${character.name}.`;
    }));
  if (allImages.length > MAX_MEDIA_ITEMS || allImages.reduce((size, url) => size + url.length, 0) > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + MAX_MEDIA_ITEMS * 64) {
    throw new Error("The combined images exceed the prompt limit. Use fewer or smaller images.");
  }
  const imagePrompt = prompt + "\n" + labels.join("\n");
  if (imagePrompt.length > 8000) throw new Error("The prompt and Character notes are too long. Use a shorter prompt or fewer Characters.");
  return { task: { ...task, prompt: imagePrompt }, images: allImages };
}
