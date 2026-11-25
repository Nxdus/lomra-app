import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { namedFewStep, readCheckpoint } from './sd-header.mjs';

const checkpoint = /\.(?:safetensors|gguf)$/i;
export const localModelId = /^local-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const newLocalModelId = () => `local-${randomUUID()}`;
export const validLocalPick = (mode, id) => mode === 'locate' ? typeof id === 'string' && /^[a-z0-9-]{1,100}$/.test(id)
  : (mode === 'file' || mode === 'folder') && id === undefined;

export function validLocalRecord(record, presets = []) {
  return !!record && typeof record.id === 'string' && (localModelId.test(record.id) || presets.includes(record.id))
    && typeof record.path === 'string' && isAbsolute(record.path) && checkpoint.test(record.path) && !record.path.includes('\0')
    && typeof record.family === 'string' && Number.isSafeInteger(record.bytes) && record.bytes > 0
    && Number.isFinite(record.mtimeMs);
}

function inside(root, file) {
  const rel = relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Scan the conventional checkpoint directories first, or the chosen directory itself. */
export async function scanCheckpoints(folder, { maxDepth = 4, maxEntries = 2000, maxFiles = 50 } = {}) {
  const root = await realpath(folder);
  const conventional = await Promise.all(['checkpoints', 'Stable-diffusion'].map(async (name) => {
    const dir = join(root, 'models', name);
    const resolved = await realpath(dir).catch(() => null);
    return resolved && inside(root, resolved) && (await lstat(resolved).catch(() => null))?.isDirectory() ? resolved : null;
  }));
  const pending = [...new Set(conventional.filter(Boolean))].map((dir) => [dir, 0]);
  if (!pending.length) pending.push([root, 0]);
  let entries = 0;
  const files = [];
  for (const [dir, depth] of pending) {
    const resolved = await realpath(dir).catch(() => null);
    if (!resolved || !inside(root, resolved)) continue;
    const handle = await opendir(resolved).catch(() => null);
    if (!handle) continue;
    for await (const entry of handle) {
      if (++entries > maxEntries) return { root, files };
      const path = join(resolved, entry.name);
      if (entry.isDirectory() && depth < maxDepth) pending.push([path, depth + 1]);
      if (entry.isFile() && checkpoint.test(entry.name)) files.push(path);
      if (files.length >= maxFiles) return { root, files };
    }
  }
  return { root, files };
}

export async function readLocalCheckpoint(path, root) {
  const ext = extname(path).toLowerCase();
  if (!checkpoint.test(ext)) throw new Error('Choose a .safetensors or .gguf checkpoint.');
  const resolved = await realpath(path).catch(() => null);
  if (!resolved || (root && !inside(root, resolved))) throw new Error('Could not find the checkpoint file.');
  if (!(await lstat(resolved).catch(() => null))?.isFile()) throw new Error('Choose a checkpoint file.');
  const handle = await open(resolved, 'r').catch(() => null);
  if (!handle) throw new Error('Could not open the checkpoint file.');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('Choose a checkpoint file.');
    const read = async (start, length) => {
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, start);
      return buffer.subarray(0, bytesRead);
    };
    const found = await readCheckpoint(ext, read).catch(() => null);
    if (!found?.supported) throw new Error('Choose a whole Stable Diffusion 1.x, 2.x or SDXL checkpoint.');
    const name = basename(path);
    const fewStepFamily = found.family === 'sdxl' && !/sd_?xl[-_]?turbo/i.test(name) ? 'sdxl-few' : 'turbo';
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The checkpoint changed while it was being read.');
    return { path, resolved, bytes: after.size, mtimeMs: after.mtimeMs, header: { ...found, headerType: found.family, fewStepFamily, fewStep: namedFewStep(name) } };
  } finally { await handle.close(); }
}

/** Compare a few fixed data ranges without reading gigabytes from each checkpoint. */
export async function checkpointSample(path, bytes) {
  const file = await open(path, 'r');
  try {
    const hash = createHash('sha256');
    const length = Math.min(64 * 1024, bytes);
    for (const start of new Set([0, Math.floor((bytes - length) / 2), bytes - length])) {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, start);
      if (bytesRead !== length) return null;
      hash.update(buffer);
    }
    return hash.digest('hex');
  } finally { await file.close(); }
}
