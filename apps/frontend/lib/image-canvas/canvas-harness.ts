export const canvasRoles = ["Brief", "Reference", "Output"] as const;
export const canvasRelations = ["Continues from", "Uses reference"] as const;
export const canvasCardType = "application/vnd.lomra.canvas-card";
export const canvasTitleLimit = 200;
export const canvasTextLimit = 8_000;
export const canvasLinkLimit = 100;

export type CanvasLink = { to: string; relation: (typeof canvasRelations)[number] };
export type CanvasSource = { id: string; name: string };
export type CanvasProvenance = { model: string; prompt: string; selectedInputs?: CanvasSource[] };
export type CanvasHarness = {
  role?: (typeof canvasRoles)[number];
  title?: string;
  notes?: string;
  links?: CanvasLink[];
  provenance?: CanvasProvenance;
};
