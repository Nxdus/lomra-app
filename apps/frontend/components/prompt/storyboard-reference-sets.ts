import type { ReferenceImage } from "@/lib/reference-sets";
import { MAX_MEDIA_ITEMS } from "./media";
import type { Storyboard } from "./storyboard-data";

export function applyReferenceSet(board: Storyboard, images: ReferenceImage[], incoming: ReferenceImage[], shotIds: ReadonlySet<string>) {
  const nextImages = [...images];
  const references = incoming.map((image) => {
    const existing = nextImages.findIndex(({ url }) => url === image.url);
    return existing >= 0 ? existing : nextImages.push(image) - 1;
  });
  if (nextImages.length > MAX_MEDIA_ITEMS) {
    throw new Error(`This set would exceed the storyboard limit of ${MAX_MEDIA_ITEMS} reference images.`);
  }
  const shots = board.shots?.map((shot) => shot.id && shotIds.has(shot.id)
    ? { ...shot, references: [...new Set([...shot.references, ...references])] }
    : shot);
  return { board: { ...board, shots }, images: nextImages };
}
