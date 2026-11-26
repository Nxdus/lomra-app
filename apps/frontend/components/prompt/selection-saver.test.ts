import assert from "node:assert/strict";
import test from "node:test";
import { createSelectionSaver } from "./selection-saver";

test("catalog refreshes do not rewrite a hydrated selection or repeat a correction", async () => {
  const writes: string[][] = [];
  const save = createSelectionSaver(["picture:missing"], async models => { writes.push(models); });
  await save(["picture:missing"]);
  await Promise.all([save([]), save([])]);
  await save(["picture:new"]);
  await save(["picture:new"]);
  assert.deepEqual(writes, [[], ["picture:new"]]);
});
