import { createHash } from 'node:crypto';
import { sdProfiles } from './sd-profiles.mjs';

/**
 * Local image generation runs stable-diffusion.cpp's `sd-cli`. The engine build and the checkpoints below are
 * pinned: each download is checked against its SHA-256 before it is used, and the renderer can only pick them by id.
 */
export const sdRelease = 'master-1106-532d2c1';

/** The engine build per `<platform>-<arch>`. Vulkan builds run on NVIDIA, AMD and Intel GPUs. */
export const sdEngines = {
  'win32-x64': { asset: 'sd-master-532d2c1-bin-win-vulkan-x64.zip', sha256: '3e66222c87ca27074e1fd8ce79706eef17a8aaf39949906aa1bee7e060f22ecc', bytes: 30312081 },
  'darwin-arm64': { asset: 'sd-master-532d2c1-bin-Darwin-macOS-26.7.2-arm64.zip', sha256: '8146d6ffc75f8ff8f64b62a80fffee8fb714ab65e368e202084135fa07cc6f36', bytes: 38331254 },
  'linux-x64': { asset: 'sd-master-532d2c1-bin-Linux-Ubuntu-26.04-x86_64-vulkan.zip', sha256: 'ca30fe17f1735cdfb4c8561b75799070c25cc86a9e5438f4c0e1b163baae4e12', bytes: 42212329 },
};

export const sdEngineUrl = (engine) => `https://github.com/leejet/stable-diffusion.cpp/releases/download/${sdRelease}/${engine.asset}`;

/** Single-file checkpoints. `sample` hashes the first, middle and last 64 KiB for local import deduplication. */
export const sdModels = [
  {
    id: 'sd-turbo', name: 'SD Turbo', quality: 'Fast', note: 'Recommended. Four steps, quick even without a strong GPU. Stability AI community license.',
    repo: 'stabilityai/sd-turbo', file: 'sd_turbo.safetensors', sha256: '3f067a1b943cf162f2b8f8588f6cf5824bd5b4c7d1d88d87164b9ca123616549', bytes: 5214561328,
    sample: 'e2df3a05730f1132f3ecac92f862b2f989335841c3d2fc03a9ca6573902d0237',
    profile: 'turbo', default: true,
  },
  {
    id: 'sdxl-turbo', name: 'SDXL Turbo', quality: 'Better detail', note: 'Needs about 8 GB of memory. Stability AI community license.',
    repo: 'stabilityai/sdxl-turbo', file: 'sd_xl_turbo_1.0_fp16.safetensors', sha256: 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26', bytes: 6938081905,
    sample: '023c32b6496f147361598ee3d21933d7ed863c4e66cd0da04ade5cca0613a8ac',
    profile: 'turbo',
  },
  {
    id: 'sd15', name: 'Stable Diffusion 1.5', quality: 'Classic', note: 'Slower (20 steps) but the most flexible. CreativeML OpenRAIL-M license.',
    repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5', file: 'v1-5-pruned-emaonly.safetensors', sha256: '6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa', bytes: 4265146304,
    sample: '3f8df4148b88a013e2f2a866980a515cf3b6108f2f78f179777ff7f91eebc17f',
    profile: 'sd15',
  },
];

export const defaultSdModel = sdModels.find((model) => model.default).id;
export const encodeHfPath = (file) => file.split('/').map(encodeURIComponent).join('/');
export const sdModelUrl = (model) => `https://huggingface.co/${model.repo}/resolve/main/${encodeHfPath(model.file)}`;

/** The number a `W:H` aspect ratio stands for; 1 when it is missing or makes no sense. */
export function aspectRatioOf(aspectRatio) {
  const match = /^(\d{1,3}(?:\.\d+)?):(\d{1,3}(?:\.\d+)?)$/.exec(aspectRatio ?? '');
  const ratio = match ? Number(match[1]) / Number(match[2]) : 1;
  return ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
}

/** Width and height for an `W:H` aspect ratio with the long side at `size`, rounded to the multiples of 8 the engine needs. */
export function sdDimensions(aspectRatio, size) {
  const ratio = Math.min(Math.max(aspectRatioOf(aspectRatio), 1 / 4), 4);
  const snap = (value) => Math.max(64, Math.round(value / 8) * 8);
  return ratio >= 1 ? { width: size, height: snap(size / ratio) } : { width: snap(size * ratio), height: size };
}

/** Re-exported for callers/tests that import the profile list under its older name. */
export const sdFamilies = sdProfiles;

export const hfRepoPattern = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;
/** Checkpoint paths up to four subfolders deep. Ignore diffusers component directories. */
export const hfFilePattern = /^(?=.{1,512}$)(?:(?!(?:unet|vae|text_encoder|transformer|controlnet|image_encoder|safety_checker)(?:_\d+)?\/)[\w-][\w. -]{0,199}\/){0,4}[\w-][\w. -]{0,199}\.(?:safetensors|gguf)$/i;

/** A Hugging Face `owner/name` or a huggingface.co link (optionally to one file on `main`), as `{ repo, file? }`. */
export function parseHuggingFace(input) {
  let path = String(input ?? '').trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.origin !== 'https://huggingface.co' || url.username || url.password) return null;
      // URL normalizes dot segments before exposing pathname, so validate the original segments.
      const raw = /^https:\/\/huggingface\.co\/([^?#]*)/i.exec(path)?.[1];
      if (!raw) return null;
      const segments = raw.split('/').map(decodeURIComponent);
      if (segments.some((segment) => segment.startsWith('.') || /[\\/]/.test(segment))) return null;
      path = segments.join('/');
    } catch { return null; }
  }
  const [owner, name, kind, revision, ...rest] = path.split('/');
  if (!owner || !name) return null;
  const repo = `${owner}/${name}`;
  if (!hfRepoPattern.test(repo)) return null;
  const target = rest.join('/');
  const file = (kind === 'blob' || kind === 'resolve') && revision === 'main' && hfFilePattern.test(target) ? target : undefined;
  if ((kind === 'blob' || kind === 'resolve') && !file && (revision !== 'main' || !/^[\w-][\w.-]*\.ckpt$/i.test(target))) return null;
  if (kind !== undefined && kind !== 'blob' && kind !== 'resolve' && kind !== 'tree' && !(kind === '' && revision === undefined)) return null;
  return file ? { repo, file } : { repo };
}

/** A safe, stable id (`hf-…`, usable as a file name and in `sd/<id>`) for a Hugging Face file. */
export function customModelId(repo, file) {
  const slug = `${repo}-${file.replace(/\.[^.]+$/, '')}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  return `hf-${slug}-${createHash('sha1').update(`${repo}/${file}`).digest('hex').slice(0, file.includes('/') ? 24 : 6)}`;
}
