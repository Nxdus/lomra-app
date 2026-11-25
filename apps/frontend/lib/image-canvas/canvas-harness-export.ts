import { strToU8, zipSync } from "three/addons/libs/fflate.module.js";
import { sdDetails } from "../sd-settings";
import { canvasCardType } from "./canvas-harness";
import { isCanvasFilePending, loadCanvasFile, type CanvasImage } from "./image-canvas-storage";

const inline = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!).replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&");
const quote = (text: string) => text.replace(/\r\n?/g, "\n").split("\n").map(line => `> ${inline(line)}`).join("\n");
const filename = (item: CanvasImage) => `files/${item.id}-${item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150)}`;

export function canvasHandoff(items: CanvasImage[], selected: ReadonlySet<string>) {
  const byId = new Map(items.map(item => [item.id, item]));
  const chosen = items.filter(item => selected.has(item.id));
  const lines = ["# Canvas handoff"];
  for (const item of chosen) {
    const { role, title, notes, links, provenance } = item.harness ?? {};
    lines.push("", `## ${inline(title ?? item.file.name)}`, "", `- ID: ${item.id}`);
    if (role) lines.push(`- Role: ${role}`);
    if (item.file.type !== canvasCardType) lines.push(`- File: [${inline(item.file.name)}](${filename(item)})`);
    if (notes) lines.push("", quote(notes));
    for (const { to, relation } of links ?? []) {
      const target = byId.get(to);
      if (target) lines.push(`- ${relation}: ${inline(target.harness?.title ?? target.file.name)} (${to})${selected.has(to) ? "" : " · outside this export"}`);
    }
    if (provenance) {
      lines.push("", `- Model: ${inline(provenance.model)}`);
      if (provenance.aspectRatio) lines.push(`- Aspect ratio: ${inline(provenance.aspectRatio)}`);
      for (const input of provenance.selectedInputs ?? []) lines.push(`- Selected input: ${inline(input.name)} (${input.id})`);
      if (provenance.sd) for (const { label, value } of sdDetails(provenance.sd)) lines.push(`- ${label}: ${inline(value)}`);
      if (provenance.prompt) lines.push("", "Prompt", "", quote(provenance.prompt));
    }
  }
  return { markdown: lines.join("\n") + "\n", assets: chosen.filter(item => item.file.type !== canvasCardType) };
}

export async function canvasHandoffZip(markdown: string, assets: CanvasImage[]) {
  const files: Record<string, Uint8Array> = { "canvas.md": strToU8(markdown) };
  let bytes = files["canvas.md"].byteLength;
  for (const item of assets) {
    const file = isCanvasFilePending(item.file) ? await loadCanvasFile(item) : item.file;
    bytes += file.size;
    if (bytes > 300 * 1024 * 1024) throw new Error("This handoff exceeds 300 MB. Select fewer files and try again.");
    files[filename(item)] = new Uint8Array(await file.arrayBuffer());
  }
  return new Blob([Uint8Array.from(zipSync(files, { level: 0 }))], { type: "application/zip" });
}
