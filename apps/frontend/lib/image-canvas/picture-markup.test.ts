import assert from "node:assert/strict";
import test from "node:test";
import { emptyMarkup, markupHistory, markupBounds, hitMarkup, moveMarkup, type Markup } from "./picture-markup";

const rectangle: Markup = { id: "shape", kind: "rectangle", points: [{ x: 80, y: 60 }, { x: 20, y: 10 }], color: "red", width: 4 };

test("reverse-drag shapes can be selected and moved without changing the source", () => {
  assert.deepEqual(markupBounds(rectangle), { x: 20, y: 10, width: 60, height: 50 });
  assert.equal(hitMarkup([rectangle], { x: 25, y: 15 }, 4)?.id, "shape");
  assert.equal(hitMarkup([rectangle], { x: 150, y: 15 }, 4), undefined);
  assert.deepEqual(moveMarkup(rectangle, 10, -5).points, [{ x: 90, y: 55 }, { x: 30, y: 5 }]);
  assert.equal(rectangle.points[0].x, 80);
});

test("undo/redo restores selections and a new edit discards the redo branch", () => {
  const first = markupHistory(emptyMarkup, { type: "commit", items: [rectangle] });
  const second = markupHistory(first, { type: "commit", items: [rectangle, { ...rectangle, id: "second" }] });
  const undone = markupHistory(second, { type: "undo" });
  assert.deepEqual(undone.items, [rectangle]);
  assert.deepEqual(markupHistory(undone, { type: "redo" }).items, second.items);
  assert.equal(markupHistory(undone, { type: "commit", items: [] }).future.length, 0);
  assert.deepEqual(markupHistory(second, { type: "reset" }), emptyMarkup);
  assert.equal(markupHistory(emptyMarkup, { type: "undo" }), emptyMarkup);
});
