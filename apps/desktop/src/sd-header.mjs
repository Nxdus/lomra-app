/** Enough for any checkpoint's table of contents; the largest SDXL ones are under 1 MB. */
const maxHeader = 8 * 1024 * 1024;

/** Thrown when a header could not be read, which says nothing about whether the engine can run the file. */
export class UnreadableHeader extends Error {}

/** The name and shape of every tensor in a `.safetensors` file. `read(start, length)` resolves to those bytes. */
async function safetensorsShapes(read) {
  const size = Number((await read(0, 8)).readBigUInt64LE());
  if (!(size > 1 && size <= maxHeader)) throw new UnreadableHeader();
  let header;
  try { header = JSON.parse((await read(8, size)).toString('utf8')); } catch (cause) { throw cause instanceof UnreadableHeader ? cause : new UnreadableHeader(); }
  return new Map(Object.entries(header ?? {}).flatMap(([name, tensor]) => Array.isArray(tensor?.shape) ? [[name, tensor.shape]] : []));
}

/** The byte width of each fixed-size GGUF metadata type. */
const ggufWidths = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

function parseGguf(bytes) {
  let at = 0;
  const take = (length) => { at += length; if (at > bytes.length) throw new RangeError(); return at - length; };
  const u32 = () => bytes.readUInt32LE(take(4));
  const u64 = () => {
    const value = Number(bytes.readBigUInt64LE(take(8)));
    if (value > maxHeader) throw new UnreadableHeader();
    return value;
  };
  const text = () => { const length = u64(); const start = take(length); return bytes.toString('utf8', start, start + length); };
  const skip = (type, depth = 0) => {
    if (type === 8) { take(u64()); return; }
    if (type === 9 && depth < 2) {
      const item = u32();
      const count = u64();
      if (ggufWidths[item]) take(ggufWidths[item] * count);
      else for (let index = 0; index < count; index++) skip(item, depth + 1);
      return;
    }
    if (!ggufWidths[type]) throw new UnreadableHeader();
    take(ggufWidths[type]);
  };
  if (bytes.toString('latin1', 0, 4) !== 'GGUF') throw new UnreadableHeader();
  take(4);
  // Version 1 stored 32-bit counts; the engine does not read it either.
  if (u32() < 2) throw new UnreadableHeader();
  const tensors = u64();
  const entries = u64();
  for (let index = 0; index < entries; index++) { text(); skip(u32()); }
  const shapes = new Map();
  for (let index = 0; index < tensors; index++) {
    const name = text();
    const count = u32();
    if (count > 8) throw new UnreadableHeader();
    // GGUF lists dimensions from the innermost one.
    shapes.set(name, Array.from({ length: count }, u64).reverse());
    take(12);
  }
  return shapes;
}

/** The same for a `.gguf` file, whose header does not say how long it is. */
async function ggufShapes(read) {
  for (let size = 256 * 1024; size <= maxHeader; size *= 4) {
    const bytes = await read(0, size);
    try { return parseGguf(bytes); } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      if (bytes.length < size) break;
    }
  }
  throw new UnreadableHeader();
}

/**
 * What a checkpoint is, from its tensors: `{ supported, family, label, inpaint }`. Only whole Stable Diffusion
 * 1.x, 2.x and SDXL checkpoints are supported; anything else (another architecture, a LoRA, a ControlNet, a UNet
 * without its text encoder) is `{ supported: false }`.
 */
export function classify(shapes) {
  const part = (...prefixes) => [...shapes.keys()].some((name) => prefixes.some((prefix) => name.startsWith(prefix)));
  const unet = (name) => shapes.get(`model.diffusion_model.${name}`);
  const channels = unet('input_blocks.0.0.weight')?.[1];
  const context = (unet('input_blocks.1.1.transformer_blocks.0.attn2.to_k.weight') ?? unet('input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight'))?.[1];
  const kind = { 768: { family: 'sd15', label: 'SD 1.5' }, 1024: { family: 'sd15', label: 'SD 2' }, 2048: { family: 'sdxl', label: 'SDXL' } }[context];
  if (!kind || (channels !== 4 && channels !== 9) || !part('first_stage_model.') || !part('cond_stage_model.', 'conditioner.')) return { supported: false };
  return { supported: true, ...kind, inpaint: channels === 9 };
}

/** Reads and classifies a checkpoint. Throws `UnreadableHeader` when its header cannot be read. */
export async function readCheckpoint(ext, read) {
  return classify(await (ext === '.gguf' ? ggufShapes(read) : safetensorsShapes(read)));
}

/** A model distilled to draw in a few steps. Nothing in the file says so, only its name. */
export const namedFewStep = (name) => /turbo|lightning|lcm|hyper/i.test(name);
