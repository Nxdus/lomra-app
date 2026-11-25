import { randomInt } from 'node:crypto';
import { defaultSdStrength, resolveSdProfile } from './sd-profiles.mjs';

/** Hard upper limits on what the renderer may ask of one image; `lib/sd-settings.ts` in the frontend has the same numbers. */
export const sdLimits = { prompt: 2000, seed: 2147483647, steps: 50, cfg: 20 };
/** stable-diffusion.cpp's own default for image-to-image. */
export const defaultStrength = defaultSdStrength;
/** A brushed area is meant to become something else; below this the old picture mostly comes back. */
const defaultMaskStrength = 1;
const maxImageBytes = 20 * 1024 * 1024;
const maxSide = 8192;
/** The engine rounds every picture up to this multiple and crops the source to fit, so edits ask for it exactly. */
const edgeMultiple = 64;

/** Width and height from a PNG, JPEG or WebP header, or null. */
export function imageSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('latin1', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const kind = bytes.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8) {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker === 0xff) { at += 1; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

/** The size to redraw a `ratio` (width / height) picture at: edges the engine keeps, at most the model's area, closest shape. */
export function editDimensions(ratio, size) {
  const target = Math.min(Math.max(ratio, 1 / 4), 4);
  let best = { width: size, height: size, score: Infinity };
  for (let width = edgeMultiple * 4; width <= size * 2; width += edgeMultiple) {
    for (let height = edgeMultiple * 4; height <= size * 2 && width * height <= size * size; height += edgeMultiple) {
      const score = 2 * Math.abs(Math.log(width / height / target)) + 0.25 * Math.log(size * size / (width * height));
      if (score < best.score) best = { width, height, score };
    }
  }
  return { width: best.width, height: best.height };
}

function picture(value, types, message) {
  const match = typeof value === 'string' && value.length <= maxImageBytes * 1.4 ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(value) : null;
  if (!match || !types.includes(match[1])) throw new Error(message);
  const bytes = Buffer.from(match[2], 'base64');
  const size = imageSize(bytes);
  if (!size || bytes.length > maxImageBytes || !(size.width > 0 && size.height > 0) || size.width > maxSide || size.height > maxSide) throw new Error(message);
  return { bytes, ext: match[1], ...size };
}

function bounded(value, min, max, message, whole = false) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) throw new Error(message);
  return value;
}

/**
 * Checks what the renderer sent for one image against `model`'s profile ranges and capabilities (clamped by hard limits),
 * and fills in defaults and a random seed. Throws a message the user can read.
 */
export function sdInput(input, model) {
  const profile = resolveSdProfile(model);
  const { capabilities, ranges } = profile;
  const minSteps = Math.max(1, ranges.steps.min);
  const maxSteps = Math.min(sdLimits.steps, ranges.steps.max);
  const minCfg = Math.max(0, ranges.cfg.min);
  const maxCfg = Math.min(sdLimits.cfg, ranges.cfg.max);
  const minStrength = Math.max(0, ranges.strength.min);
  const maxStrength = Math.min(1, ranges.strength.max);

  const { prompt, aspectRatio } = input;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > sdLimits.prompt || prompt.includes('\0')) throw new Error(`Enter a prompt of up to ${sdLimits.prompt} characters.`);
  if (aspectRatio !== undefined && typeof aspectRatio !== 'string') throw new Error('Invalid aspect ratio.');
  if (input.outpaint !== undefined && !capabilities.outpaint) throw new Error('This model cannot extend a picture to a new shape.');
  if (input.images !== undefined && !capabilities.referencePictures) throw new Error('This model does not support reference pictures.');
  const negativePrompt = input.negativePrompt ?? '';
  if (typeof negativePrompt !== 'string' || negativePrompt.length > sdLimits.prompt || negativePrompt.includes('\0')) throw new Error(`Enter a negative prompt of up to ${sdLimits.prompt} characters.`);
  if (negativePrompt.trim() && !capabilities.negativePrompt) throw new Error('This model does not support a negative prompt.');
  const seed = bounded(input.seed, 0, sdLimits.seed, `Enter a whole seed from 0 to ${sdLimits.seed}.`, true) ?? randomInt(sdLimits.seed + 1);
  const defaultSteps = Math.min(maxSteps, Math.max(minSteps, profile.steps));
  const steps = bounded(input.steps, minSteps, maxSteps, `Enter ${minSteps} to ${maxSteps} steps.`, true) ?? defaultSteps;
  if (input.cfg !== undefined && !capabilities.cfg) throw new Error('This model uses a fixed CFG scale.');

  if (input.image === undefined) {
    if (input.mask !== undefined) throw new Error('A mask needs a picture to edit.');
    if (input.strength !== undefined) throw new Error('Strength needs a picture to edit.');
    if (!capabilities.textToImage) throw new Error('This model needs a picture to edit.');
    const defaultCfg = Math.min(maxCfg, Math.max(minCfg, profile.cfg));
    const cfg = capabilities.cfg ? bounded(input.cfg, minCfg, maxCfg, `Enter a CFG scale from ${minCfg} to ${maxCfg}.`) ?? defaultCfg : profile.cfg;
    const settings = { seed, steps, cfg, ...(negativePrompt.trim() && { negativePrompt }) };
    return { prompt, aspectRatio, settings };
  }
  if (input.mask !== undefined && !capabilities.inpaint) throw new Error('This model cannot edit a brushed area.');
  if (input.mask === undefined && !capabilities.imageToImage) throw new Error('This model cannot edit an existing picture.');
  const image = picture(input.image, ['png', 'jpeg', 'webp'], 'Select one PNG, JPEG or WebP picture of up to 20 MB.');
  const mask = input.mask === undefined ? undefined : picture(input.mask, ['png'], 'The mask must be a PNG of up to 20 MB.');
  if (mask && (mask.width !== image.width || mask.height !== image.height)) throw new Error('The mask must be the same size as the picture.');
  if (input.strength !== undefined && !capabilities.strength) throw new Error('This model does not support edit strength.');
  const defaultEditStrength = Math.min(maxStrength, Math.max(minStrength, profile.strength ?? defaultStrength));
  const strength = capabilities.strength
    ? bounded(input.strength, minStrength, maxStrength, `Enter a strength from ${minStrength} to ${maxStrength}.`) ?? (mask ? Math.min(maxStrength, Math.max(minStrength, defaultMaskStrength)) : defaultEditStrength)
    : undefined;
  // The engine runs only the last `steps × strength` steps; below one it hands the picture back as it was.
  if (strength !== undefined && steps * strength < 1 - 1e-6) throw new Error(`A strength of ${strength} with ${steps} step${steps === 1 ? '' : 's'} would leave the picture unchanged. Raise the strength or the steps.`);
  // An area filled from pure noise comes out far too vivid next to the rest of the picture at the usual scale.
  const defaultCfg = mask !== undefined && (strength ?? defaultMaskStrength) === 1
    ? Math.max(minCfg, Math.min(profile.cfg, 4))
    : Math.min(maxCfg, Math.max(minCfg, profile.cfg));
  const cfg = capabilities.cfg ? bounded(input.cfg, minCfg, maxCfg, `Enter a CFG scale from ${minCfg} to ${maxCfg}.`) ?? defaultCfg : profile.cfg;
  const settings = { seed, steps, cfg, ...(negativePrompt.trim() && { negativePrompt }) };
  return {
    prompt, aspectRatio: mask ? undefined : aspectRatio, image, mask,
    settings: { ...settings, ...(strength !== undefined && { strength }), image: true, ...(mask && { mask: true }) },
  };
}
