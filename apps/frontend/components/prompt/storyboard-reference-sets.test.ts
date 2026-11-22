// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { expect, test } from "bun:test";
import { MAX_MEDIA_ITEMS } from "./media";
import { applyReferenceSet } from "./storyboard-reference-sets";

const image = (url: string) => ({ name: url, url });
const shot = { description: "Close-up", seconds: 4, image: 0, references: [0], characters: [0] };
const board = { story: "A story", shots: ["one", "two", "three"].map((id) => ({ ...shot, id })) };

test("a set adds only distinct references to the chosen shots and preserves existing indices", () => {
  const selected = new Set(["one", "three"]);
  const result = applyReferenceSet(board, [image("old")], [image("old"), image("new")], selected);
  expect(result.images).toEqual([image("old"), image("new")]);
  expect(result.board.shots).toEqual([
    { ...shot, id: "one", references: [0, 1] },
    board.shots[1],
    { ...shot, id: "three", references: [0, 1] },
  ]);
  expect(applyReferenceSet(result.board, result.images, [image("new")], selected)).toEqual(result);
  expect(board.shots[0].references).toEqual([0]);
});

test("applying a set beyond the board limit leaves existing images and shots intact", () => {
  const images = Array.from({ length: MAX_MEDIA_ITEMS }, (_, index) => image(String(index)));
  expect(() => applyReferenceSet(board, images, [image("new")], new Set(["one"]))).toThrow("storyboard limit");
  expect(images).toHaveLength(MAX_MEDIA_ITEMS);
  expect(board.shots[0].references).toEqual([0]);
});
