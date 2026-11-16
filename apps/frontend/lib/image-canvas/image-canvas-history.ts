import type { CanvasCamera } from "./image-canvas-camera";

export type CanvasItemSnapshot = {
  id: string;
  file: File;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasHistoryItem = CanvasItemSnapshot;

export type CanvasHistoryActionType = "move" | "resize" | "reorganize" | "delete" | "generic";

export type CanvasHistoryEntry = {
  items: CanvasItemSnapshot[];
  camera?: CanvasCamera;
  nextCamera?: CanvasCamera;
  type?: CanvasHistoryActionType;
};

export type CanvasHistoryState = {
  past: CanvasHistoryEntry[];
  future: CanvasHistoryEntry[];
};

export const emptyCanvasHistory: CanvasHistoryState = { past: [], future: [] };
export const MAX_CANVAS_HISTORY = 40;

export function cloneCanvasItems(items: CanvasItemSnapshot[]): CanvasItemSnapshot[] {
  return items.map((item) => ({ ...item }));
}

export function areCanvasItemsEqual(a: CanvasItemSnapshot[], b: CanvasItemSnapshot[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const itemA = a[i];
    const itemB = b[i];
    if (
      itemA.id !== itemB.id ||
      itemA.x !== itemB.x ||
      itemA.y !== itemB.y ||
      itemA.width !== itemB.width ||
      itemA.height !== itemB.height ||
      itemA.file !== itemB.file ||
      itemA.url !== itemB.url
    ) {
      return false;
    }
  }
  return true;
}

export function pushCanvasHistory(
  state: CanvasHistoryState,
  entry: CanvasHistoryEntry,
  currentItems: CanvasItemSnapshot[],
  maxHistory = MAX_CANVAS_HISTORY
): CanvasHistoryState {
  const isItemsEqual = areCanvasItemsEqual(entry.items, currentItems);
  const isCameraEqual =
    !entry.camera ||
    !entry.nextCamera ||
    (entry.camera.x === entry.nextCamera.x &&
      entry.camera.y === entry.nextCamera.y &&
      entry.camera.scale === entry.nextCamera.scale);

  if (isItemsEqual && isCameraEqual) {
    return state;
  }

  const storedEntry: CanvasHistoryEntry = {
    items: cloneCanvasItems(entry.items),
    camera: entry.camera ? { ...entry.camera } : undefined,
    nextCamera: entry.nextCamera ? { ...entry.nextCamera } : undefined,
    type: entry.type,
  };

  return {
    past: [...state.past.slice(-(maxHistory - 1)), storedEntry],
    future: [],
  };
}

export type UndoResult = {
  state: CanvasHistoryState;
  items: CanvasItemSnapshot[];
  camera?: CanvasCamera;
};

export function undoCanvasHistory(
  state: CanvasHistoryState,
  currentItems: CanvasItemSnapshot[],
  currentCamera?: CanvasCamera
): UndoResult | null {
  if (!state.past.length) return null;
  const entry = state.past[state.past.length - 1];
  const newPast = state.past.slice(0, -1);
  const futureEntry: CanvasHistoryEntry = {
    items: cloneCanvasItems(currentItems),
    camera: entry.nextCamera ? { ...entry.nextCamera } : (currentCamera ? { ...currentCamera } : undefined),
    nextCamera: entry.camera ? { ...entry.camera } : undefined,
    type: entry.type,
  };

  return {
    state: {
      past: newPast,
      future: [futureEntry, ...state.future],
    },
    items: cloneCanvasItems(entry.items),
    camera: entry.camera ? { ...entry.camera } : undefined,
  };
}

export type RedoResult = {
  state: CanvasHistoryState;
  items: CanvasItemSnapshot[];
  camera?: CanvasCamera;
};

export function redoCanvasHistory(
  state: CanvasHistoryState,
  currentItems: CanvasItemSnapshot[],
  currentCamera?: CanvasCamera
): RedoResult | null {
  if (!state.future.length) return null;
  const entry = state.future[0];
  const newFuture = state.future.slice(1);
  const pastEntry: CanvasHistoryEntry = {
    items: cloneCanvasItems(currentItems),
    camera: entry.nextCamera ? { ...entry.nextCamera } : (currentCamera ? { ...currentCamera } : undefined),
    nextCamera: entry.camera ? { ...entry.camera } : undefined,
    type: entry.type,
  };

  return {
    state: {
      past: [...state.past, pastEntry],
      future: newFuture,
    },
    items: cloneCanvasItems(entry.items),
    camera: entry.camera ? { ...entry.camera } : undefined,
  };
}

export function collectReferencedUrls(
  currentItems: CanvasItemSnapshot[],
  histories: Iterable<CanvasHistoryState>
): Set<string> {
  const referenced = new Set<string>();
  for (const item of currentItems) {
    if (item.url) referenced.add(item.url);
  }
  for (const history of histories) {
    for (const entry of history.past) {
      for (const item of entry.items) {
        if (item.url) referenced.add(item.url);
      }
    }
    for (const entry of history.future) {
      for (const item of entry.items) {
        if (item.url) referenced.add(item.url);
      }
    }
  }
  return referenced;
}

export function isNativeTextEditingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    isContentEditable?: boolean;
    tagName?: string;
    closest?: (selector: string) => unknown;
  };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (typeof el.closest === "function") {
    return Boolean(
      el.closest('input, textarea, select, [contenteditable="true"], [data-canvas-interactive], [role="dialog"]')
    );
  }
  return false;
}

export function isUndoKeyboardShortcut(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "z"
  );
}

export function isRedoKeyboardShortcut(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): boolean {
  const isCtrlOrCmdShiftZ =
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "z";
  const isWindowsCtrlY =
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "y";
  return isCtrlOrCmdShiftZ || isWindowsCtrlY;
}
