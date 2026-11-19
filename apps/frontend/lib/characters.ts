export const characterNameLimit = 64;
export const characterNotesLimit = 1000;
export const characterNamePattern = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*$/u;
export const characterImageType = /^image\/(?:png|jpeg|webp|gif)$/;

export type Character = { id: string; name: string; notes: string; imageType: string };

export function characterNameKey(name: string) {
  return name.normalize("NFC").toLowerCase();
}

export function mentionedCharacters(prompt: string, characters: Character[]) {
  const matches = new Set(Array.from(
    prompt.matchAll(/(?<![@\p{L}\p{M}\p{N}_])@([\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*)/gu),
    ([, name]) => characterNameKey(name),
  ));
  return Array.from(matches).flatMap((name) => {
    const found = characters.filter((character) => characterNameKey(character.name) === name);
    if (found.length > 1) throw new Error(`@${found[0].name} is used by more than one Character.`);
    return found;
  });
}
