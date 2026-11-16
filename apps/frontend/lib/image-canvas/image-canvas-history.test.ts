import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyCanvasHistory,
  pushCanvasHistory,
  undoCanvasHistory,
  redoCanvasHistory,
  areCanvasItemsEqual,
  collectReferencedUrls,
  isUndoKeyboardShortcut,
  isRedoKeyboardShortcut,
  isNativeTextEditingTarget,
  type CanvasHistoryItem,
  type CanvasHistoryState,
} from "./image-canvas-history";

function makeItem(id: string, x: number, y: number, width = 100, height = 100, url = `blob:${id}`): CanvasHistoryItem {
  return {
    id,
    file: new File(["dummy"], `${id}.png`, { type: "image/png" }),
    url,
    x,
    y,
    width,
    height,
  };
}

test("operation order: move, resize, reorganize and delete undo and redo chronologically", () => {
  const itemA = makeItem("a", 10, 10, 100, 100);
  const itemB = makeItem("b", 200, 200, 150, 150);
  const cam0 = { x: 0, y: 0, scale: 1 };
  let currentItems = [itemA, itemB];
  let history: CanvasHistoryState = emptyCanvasHistory;

  // 1. Move itemA
  const movedA = { ...itemA, x: 50, y: 60 };
  const stateAfterMove = [movedA, itemB];
  history = pushCanvasHistory(history, { items: currentItems, type: "move" }, stateAfterMove);
  currentItems = stateAfterMove;

  // 2. Resize itemB
  const resizedB = { ...itemB, width: 300, height: 300 };
  const stateAfterResize = [movedA, resizedB];
  history = pushCanvasHistory(history, { items: currentItems, type: "resize" }, stateAfterResize);
  currentItems = stateAfterResize;

  // 3. Reorganize both items with camera change
  const camReorg = { x: 100, y: 100, scale: 0.5 };
  const reorgA = { ...movedA, x: 0, y: 0, width: 120, height: 120 };
  const reorgB = { ...resizedB, x: 150, y: 0, width: 120, height: 120 };
  const stateAfterReorg = [reorgA, reorgB];
  history = pushCanvasHistory(
    history,
    { items: currentItems, camera: cam0, nextCamera: camReorg, type: "reorganize" },
    stateAfterReorg
  );
  currentItems = stateAfterReorg;

  // 4. Delete itemB
  const stateAfterDelete = [reorgA];
  history = pushCanvasHistory(history, { items: currentItems, type: "delete" }, stateAfterDelete);
  currentItems = stateAfterDelete;

  assert.equal(history.past.length, 4);

  // Undo 1: Undoes delete (restores itemB)
  const u1 = undoCanvasHistory(history, currentItems, camReorg);
  assert.ok(u1);
  history = u1.state;
  currentItems = u1.items;
  assert.equal(currentItems.length, 2);
  assert.equal(currentItems[1].id, "b");
  assert.equal(currentItems[1].width, 120);
  assert.equal(u1.camera, undefined);

  // Undo 2: Undoes reorganize (restores bounds and camera to cam0)
  const u2 = undoCanvasHistory(history, currentItems, camReorg);
  assert.ok(u2);
  history = u2.state;
  currentItems = u2.items;
  assert.deepEqual(currentItems, stateAfterResize);
  assert.deepEqual(u2.camera, cam0);

  // Undo 3: Undoes resize of itemB
  const u3 = undoCanvasHistory(history, currentItems, cam0);
  assert.ok(u3);
  history = u3.state;
  currentItems = u3.items;
  assert.deepEqual(currentItems, stateAfterMove);
  assert.equal(u3.camera, undefined);

  // Undo 4: Undoes move of itemA (back to original itemA)
  const u4 = undoCanvasHistory(history, currentItems, cam0);
  assert.ok(u4);
  history = u4.state;
  currentItems = u4.items;
  assert.deepEqual(currentItems, [itemA, itemB]);
  assert.equal(u4.camera, undefined);

  // Past is empty now
  assert.equal(history.past.length, 0);
  assert.equal(history.future.length, 4);
  assert.equal(undoCanvasHistory(history, currentItems), null);

  // Redo 1: Redoes move of itemA
  const r1 = redoCanvasHistory(history, currentItems, cam0);
  assert.ok(r1);
  history = r1.state;
  currentItems = r1.items;
  assert.deepEqual(currentItems, stateAfterMove);

  // Redo 2: Redoes resize of itemB
  const r2 = redoCanvasHistory(history, currentItems, cam0);
  assert.ok(r2);
  history = r2.state;
  currentItems = r2.items;
  assert.deepEqual(currentItems, stateAfterResize);

  // Redo 3: Redoes reorganize (restores reorg bounds and reorg camera)
  const r3 = redoCanvasHistory(history, currentItems, cam0);
  assert.ok(r3);
  history = r3.state;
  currentItems = r3.items;
  assert.deepEqual(currentItems, stateAfterReorg);
  assert.deepEqual(r3.camera, camReorg);

  // Redo 4: Redoes delete of itemB
  const r4 = redoCanvasHistory(history, currentItems, camReorg);
  assert.ok(r4);
  history = r4.state;
  currentItems = r4.items;
  assert.deepEqual(currentItems, stateAfterDelete);
  assert.equal(history.future.length, 0);
  assert.equal(redoCanvasHistory(history, currentItems), null);
});

test("grouping: multi-frame drag or resize produces only one history entry on completion", () => {
  const original = [makeItem("c1", 0, 0)];
  let currentItems = original;
  let history: CanvasHistoryState = emptyCanvasHistory;

  // Simulate drag start snapshot
  const dragSnapshot = currentItems;

  // Intermediate pointer move frames (these do NOT push to history)
  for (let offset = 1; offset <= 20; offset++) {
    currentItems = [{ ...currentItems[0], x: offset * 5, y: offset * 3 }];
  }

  // Pointer up / finishDrag: single push
  history = pushCanvasHistory(history, { items: dragSnapshot, type: "move" }, currentItems);
  assert.equal(history.past.length, 1);
  assert.equal(history.past[0].items[0].x, 0);
  assert.equal(currentItems[0].x, 100);

  // Undo takes it straight back to initial 0, 0
  const u = undoCanvasHistory(history, currentItems);
  assert.ok(u);
  assert.equal(u.items[0].x, 0);
  assert.equal(u.items[0].y, 0);
});

test("delete restoration: preserves File references, valid blob URLs and item bounds", () => {
  const item1 = makeItem("del1", 50, 60, 200, 150);
  const item2 = makeItem("del2", 300, 400, 100, 100);
  let currentItems = [item1, item2];
  let history: CanvasHistoryState = emptyCanvasHistory;

  // Delete item1
  const afterDelete = [item2];
  history = pushCanvasHistory(history, { items: currentItems, type: "delete" }, afterDelete);
  currentItems = afterDelete;

  // Undo delete
  const restored = undoCanvasHistory(history, currentItems);
  assert.ok(restored);
  assert.equal(restored.items.length, 2);
  const restoredItem1 = restored.items.find((item) => item.id === "del1");
  assert.ok(restoredItem1);
  assert.equal(restoredItem1.file, item1.file); // Exact same File instance
  assert.equal(restoredItem1.url, item1.url);   // Exact same blob URL
  assert.equal(restoredItem1.x, 50);
  assert.equal(restoredItem1.y, 60);
  assert.equal(restoredItem1.width, 200);
  assert.equal(restoredItem1.height, 150);
});

test("redo invalidation: new edit clears future stack", () => {
  const item1 = makeItem("e1", 0, 0);
  let currentItems = [item1];
  let history: CanvasHistoryState = emptyCanvasHistory;

  // Edit 1
  const moved = [{ ...item1, x: 100, y: 100 }];
  history = pushCanvasHistory(history, { items: currentItems, type: "move" }, moved);
  currentItems = moved;

  // Undo Edit 1
  const undone = undoCanvasHistory(history, currentItems);
  assert.ok(undone);
  history = undone.state;
  currentItems = undone.items;
  assert.equal(history.future.length, 1);

  // New Edit 2 while future has entries
  const branched = [{ ...item1, x: 999, y: 999 }];
  history = pushCanvasHistory(history, { items: currentItems, type: "move" }, branched);
  currentItems = branched;

  // Future must be cleared!
  assert.equal(history.future.length, 0);
  assert.equal(redoCanvasHistory(history, currentItems), null);
});

test("Canvas isolation: separate histories per canvas do not leak across canvases", () => {
  const canvasAItems = [makeItem("a1", 10, 10)];
  const canvasBItems = [makeItem("b1", 500, 500)];

  let historyA: CanvasHistoryState = emptyCanvasHistory;
  let historyB: CanvasHistoryState = emptyCanvasHistory;

  // Action on Canvas A
  const canvasAItemsMoved = [{ ...canvasAItems[0], x: 20 }];
  historyA = pushCanvasHistory(historyA, { items: canvasAItems, type: "move" }, canvasAItemsMoved);

  // Action on Canvas B
  const canvasBItemsMoved = [{ ...canvasBItems[0], y: 600 }];
  historyB = pushCanvasHistory(historyB, { items: canvasBItems, type: "move" }, canvasBItemsMoved);

  assert.equal(historyA.past.length, 1);
  assert.equal(historyB.past.length, 1);

  // Undoing on Canvas B does not touch Canvas A
  const undoB = undoCanvasHistory(historyB, canvasBItemsMoved);
  assert.ok(undoB);
  historyB = undoB.state;
  assert.equal(historyB.past.length, 0);
  assert.equal(historyA.past.length, 1);

  // Canvas A still undos its own move
  const undoA = undoCanvasHistory(historyA, canvasAItemsMoved);
  assert.ok(undoA);
  assert.equal(undoA.items[0].x, 10);
});

test("skip no-ops: identical items or positions do not push history", () => {
  const items = [makeItem("n1", 10, 10)];
  const history = pushCanvasHistory(emptyCanvasHistory, { items }, items);
  assert.equal(history.past.length, 0);
});

test("bounded history: evicts oldest entries beyond maximum history limit", () => {
  let items = [makeItem("b1", 0, 0)];
  let history = emptyCanvasHistory;
  const limit = 5;

  for (let i = 1; i <= 10; i++) {
    const next = [{ ...items[0], x: i * 10 }];
    history = pushCanvasHistory(history, { items, type: "move" }, next, limit);
    items = next;
  }

  assert.equal(history.past.length, limit);
  // The oldest entry should be x = 50 (10 - 5)
  assert.equal(history.past[0].items[0].x, 50);
});

test("URL retention: retains media needed by history and reports unreferenced URLs", () => {
  const item1 = makeItem("u1", 0, 0, 100, 100, "blob:url-1");
  const item2 = makeItem("u2", 0, 0, 100, 100, "blob:url-2");
  let history: CanvasHistoryState = emptyCanvasHistory;

  // Both active
  let active = [item1, item2];
  let referenced = collectReferencedUrls(active, [history]);
  assert.ok(referenced.has("blob:url-1"));
  assert.ok(referenced.has("blob:url-2"));

  // Delete item2: item2 is no longer in active, but is in history past
  active = [item1];
  history = pushCanvasHistory(history, { items: [item1, item2], type: "delete" }, active);
  referenced = collectReferencedUrls(active, [history]);
  // url-2 MUST still be referenced because it's in history!
  assert.ok(referenced.has("blob:url-1"));
  assert.ok(referenced.has("blob:url-2"));

  // Clear history: now url-2 is unreferenced
  referenced = collectReferencedUrls(active, [emptyCanvasHistory]);
  assert.ok(referenced.has("blob:url-1"));
  assert.equal(referenced.has("blob:url-2"), false);
});

test("keyboard shortcut recognition: identifies undo and redo keys properly", () => {
  // Undo: Ctrl+Z or Cmd+Z
  assert.equal(isUndoKeyboardShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "z" }), true);
  assert.equal(isUndoKeyboardShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: "Z" }), true);
  assert.equal(isUndoKeyboardShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: "z" }), false);

  // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
  assert.equal(isRedoKeyboardShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: "z" }), true);
  assert.equal(isRedoKeyboardShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: "Z" }), true);

  // Redo: Windows Ctrl+Y
  assert.equal(isRedoKeyboardShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "y" }), true);
  assert.equal(isRedoKeyboardShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "Y" }), true);
  assert.equal(isRedoKeyboardShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: "y" }), false);
});

test("areCanvasItemsEqual: detects matching and differing items correctly", () => {
  const item1 = makeItem("i1", 10, 20);
  const item2 = makeItem("i2", 30, 40);
  assert.equal(areCanvasItemsEqual([item1, item2], [item1, item2]), true);
  assert.equal(areCanvasItemsEqual([item1], [item1, item2]), false);
  assert.equal(areCanvasItemsEqual([item1], [{ ...item1, x: 99 }]), false);
});

test("isNativeTextEditingTarget: identifies interactive inputs and textareas", () => {
  assert.equal(isNativeTextEditingTarget(null), false);
  assert.equal(isNativeTextEditingTarget({ tagName: "INPUT" }), true);
  assert.equal(isNativeTextEditingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isNativeTextEditingTarget({ tagName: "SELECT" }), true);
  assert.equal(isNativeTextEditingTarget({ tagName: "DIV" }), false);
  assert.equal(isNativeTextEditingTarget({ isContentEditable: true }), true);
  assert.equal(isNativeTextEditingTarget({ tagName: "DIV", closest: (s: string) => s.includes("data-canvas-interactive") ? {} : null }), true);
});
