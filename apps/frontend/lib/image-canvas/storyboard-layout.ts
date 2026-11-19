// Shared hook between the canvas and the storyboard: the canvas undo history snapshots the storyboard layout through it.
export type Point = { x: number; y: number };
// Where the storyboard sits on the canvas and where each shot node was dragged to (undefined: default grid slot).
export type StoryboardLayout = { origin?: Point; shots: (Point | undefined)[] };

export const storyboardLayout: {
  read: () => StoryboardLayout | null;
  write: (layout: StoryboardLayout) => void;
  record?: (before: StoryboardLayout) => void;
} = { read: () => null, write: () => {} };
