import { strToU8, zipSync } from "three/addons/libs/fflate.module.js";
import { storageFile } from "@/lib/storage";
import type { Storyboard } from "./storyboard-data";
import type { StoryboardDialogProps } from "./storyboard-preview";

type Images = StoryboardDialogProps["images"];
type Asset = { bytes: Uint8Array<ArrayBuffer>; extension: string };

function imageExtension(bytes: Uint8Array, type: string) {
  const extension = /^image\/(png|jpeg|gif|webp|avif|bmp)$/.exec(type)?.[1];
  if (extension) return extension === "jpeg" ? "jpg" : extension;

  // The workspace file endpoint serves raw bytes as application/octet-stream.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const header = new TextDecoder().decode(bytes.subarray(0, 12));
  if (header.startsWith("\ufffdPNG\r\n\x1a\n")) return "png";
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "gif";
  if (header.startsWith("RIFF") && header.endsWith("WEBP")) return "webp";
  if (header.slice(4) === "ftypavif") return "avif";
}

function markdownLabel(label: string) {
  return label.replace(/\s+/g, " ").replace(/[\\[\]]/g, "\\$&");
}

export async function prepareStoryboardExport(
  storyboard: Storyboard,
  images: Images,
  signal?: AbortSignal,
  readFile = storageFile,
) {
  const files: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  const assets = new Map<string, Promise<Asset | undefined>>();

  async function loadAsset(index: number | null, id?: string) {
    const url = index === null ? undefined : images[index]?.url;
    const localUrl = url && /^(data:image\/|blob:)/i.test(url) ? url : undefined;
    const key = localUrl ?? id;
    if (!key) return;
    let pending = assets.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const blob = localUrl
            ? await fetch(localUrl, { signal }).then((response) => response.ok ? response.blob() : undefined)
            : await readFile(key);
          if (!blob?.size) return;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const extension = imageExtension(bytes, blob.type);
          if (extension) return { bytes, extension };
        } catch {
          // Missing files are recorded in the Markdown and the export dialog.
        }
      })();
      assets.set(key, pending);
    }
    return pending;
  }

  async function addAsset(path: string, label: string, index: number | null, id?: string) {
    const asset = await loadAsset(index, id);
    if (!asset) {
      missing.push(label);
      return "Missing";
    }
    const filename = `${path}.${asset.extension}`;
    files[filename] = asset.bytes;
    return `[${markdownLabel(label)}](${filename})`;
  }

  const characters = storyboard.characters ?? [];
  const shots = storyboard.shots ?? [];
  const seenShotIds = new Set<string>();
  const lines = ["# Storyboard", "", "## Story", "", storyboard.story, "", "## Shots", ""];
  for (const [index, shot] of shots.entries()) {
    signal?.throwIfAborted();
    const number = index + 1;
    const id = shot.id && /^[\w-]+$/.test(shot.id) && !seenShotIds.has(shot.id) ? shot.id : undefined;
    if (id) seenShotIds.add(id);
    const path = id ? `shots/id-${id}` : `shots/shot-${number}`;
    lines.push(`### Shot ${number}`, "", `- Duration: ${shot.seconds} s`);
    if (id) lines.push(`- ID: ${id}`);
    if (shot.scene) lines.push(`- Scene: ${shot.scene}`);
    if (shot.camera) lines.push(`- Camera: ${shot.camera}`);
    if (shot.dialogue) lines.push(`- Dialogue: ${shot.dialogue}`);
    if (shot.sound) lines.push(`- Sound: ${shot.sound}`);
    const cast = shot.characters?.map((characterIndex) => characters[characterIndex]?.name).filter(Boolean);
    if (cast?.length) lines.push(`- Cast: ${cast.join(", ")}`);
    lines.push(`- Picture: ${await addAsset(`${path}/picture`, `Shot ${number} picture`, shot.image, shot.generatedId)}`);
    for (const reference of new Set(shot.references)) {
      const name = images[reference]?.name || `Reference ${reference + 1}`;
      const link = await addAsset(`${path}/reference-${reference + 1}`, `Shot ${number} reference: ${name}`, reference);
      lines.push(`- Reference: ${link}`);
    }
    lines.push("", shot.description, "");
  }

  const approved = characters.filter(({ approved }) => approved);
  if (approved.length) lines.push("## Approved cast", "");
  for (const [index, character] of approved.entries()) {
    signal?.throwIfAborted();
    const link = await addAsset(`cast/character-${index + 1}`, `${character.name} reference`, character.image, character.generatedId);
    lines.push(`### ${character.name}`, "", character.notes, "", `- Reference: ${link}`, "");
  }
  signal?.throwIfAborted();
  if (missing.length) lines.push("## Missing assets", "", ...missing.map((label) => `- ${markdownLabel(label)}`), "");
  return { markdown: lines.join("\n"), files, missing };
}

export function storyboardZip(markdown: string, files: Record<string, Uint8Array>) {
  return Uint8Array.from(zipSync({ "storyboard.md": strToU8(markdown), ...files }, { level: 0 }));
}
