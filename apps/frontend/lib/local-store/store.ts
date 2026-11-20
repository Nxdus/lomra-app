import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Storyboard } from '../../components/prompt/storyboard-data';
import { exportProject, importProject } from './import-export';
import { StoreError, validId, validateValue, type Kind } from './validation';

const MAX_FILE = 100 * 1024 * 1024;

function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function decrypt(value: string, key: Buffer) {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}

async function atomicWrite(path: string, data: string | Uint8Array) {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function readOptional(path: string) {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Account data as plain files: `<root>/<kind>/<id>.json` and `<root>/files/<id>`. */
export function createLocalStore(root: string, secret: Buffer) {
  const dir = (kind: string) => join(root, kind);
  const jsonPath = (kind: Kind, id: string) => join(dir(kind), `${id}.json`);

  async function list(kind: Kind) {
    const names = await readdir(dir(kind)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const rows: { id: string; value: unknown }[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const raw = await readOptional(join(dir(kind), name));
      if (!raw) continue;
      const value = JSON.parse(raw.toString('utf8'));
      rows.push({ id: name.slice(0, -5), value: kind === 'keys' ? decrypt(value, secret) : value });
    }
    return rows;
  }

  async function save(kind: Kind, id: string, value: unknown) {
    validateValue(kind, id, value);
    await mkdir(dir(kind), { recursive: true });
    const stored = kind === 'keys' ? encrypt((value as string).trim(), secret) : value;
    await atomicWrite(jsonPath(kind, id), JSON.stringify(stored));
  }

  // Storyboard pictures, takes and timeline audio are workspace files owned by the chat.
  async function removeStoryboardFiles(chats: unknown[]) {
    for (const chat of chats) {
      const board = (chat as { storyboard?: Storyboard } | null)?.storyboard;
      if (!board) continue;
      const files = new Set([
        ...(board.characters ?? []).map(({ generatedId }) => generatedId),
        ...(board.shots ?? []).flatMap(({ generatedId, videoId, takes }) => [generatedId, videoId, ...(takes ?? []).map(({ fileId }) => fileId)]),
        ...(board.timeline?.audio ?? []).map(({ fileId }) => fileId),
      ]);
      for (const id of files) if (id && validId(id)) await rm(join(dir('files'), id), { force: true });
    }
  }

  async function remove(kind: Kind, id: string) {
    if (!validId(id)) throw new StoreError(400, 'Invalid ID');
    if (kind === 'chats') { const raw = await readOptional(jsonPath('chats', id)); if (raw) await removeStoryboardFiles([JSON.parse(raw.toString('utf8'))]); }
    if (kind !== 'canvas') return rm(jsonPath(kind, id), { force: true });
    const canvases = await list('canvas');
    const others = new Set(canvases.filter((row) => row.id !== id).flatMap((row) => (row.value as { id: string }[]).map((item) => item.id)));
    const mine = ((canvases.find((row) => row.id === id)?.value ?? []) as { id: string }[]).map((item) => item.id);
    const chats = (await list('chats')).filter((row) => ((row.value as { canvasId?: string }).canvasId ?? 'default') === id);
    // Delete the manifest last so a failed cleanup can be retried.
    for (const file of new Set(mine)) if (!others.has(file)) await rm(join(dir('files'), file), { force: true });
    await removeStoryboardFiles(chats.map((chat) => chat.value));
    for (const chat of chats) await rm(jsonPath('chats', chat.id), { force: true });
    await rm(jsonPath('settings', id === 'default' ? 'camera' : `camera-${id}`), { force: true });
    await rm(jsonPath('settings', `canvas-name-${id}`), { force: true });
    await rm(jsonPath('canvas', id), { force: true });
  }

  async function readStoredFile(id: string) {
    if (!validId(id)) throw new StoreError(400, 'Invalid file ID');
    const data = await readOptional(join(dir('files'), id));
    if (!data) throw new StoreError(404, 'Not found');
    return data;
  }

  async function writeStoredFile(id: string, data: Uint8Array) {
    if (!validId(id)) throw new StoreError(400, 'Invalid file ID');
    if (!data.length || data.length > MAX_FILE) throw new StoreError(400, 'Invalid file (maximum 100 MB)');
    await mkdir(dir('files'), { recursive: true });
    // Files are immutable: an existing ID keeps its first content.
    if (await readOptional(join(dir('files'), id))) return;
    await atomicWrite(join(dir('files'), id), data);
  }

  const instance = {
    list,
    save,
    remove,
    readFile: readStoredFile,
    writeFile: writeStoredFile,
    exportProject: (canvasId: string) => exportProject(instance, canvasId),
    importProject: (archive: Uint8Array) => importProject(instance, archive),
  };

  return instance;
}

export type LocalStore = ReturnType<typeof createLocalStore>;

let shared: LocalStore | undefined;

/** The store for `root`, with the key secret from `LOMRA_SECRET` (64 hex chars) or `<root>/.secret`. */
export async function localStore(root: string) {
  if (shared) return shared;
  let secret = /^[a-f0-9]{64}$/.test(process.env.LOMRA_SECRET ?? '') ? Buffer.from(process.env.LOMRA_SECRET!, 'hex') : undefined;
  if (!secret) {
    await mkdir(root, { recursive: true });
    const path = join(root, '.secret');
    secret = await readOptional(path);
    if (secret?.length !== 32) {
      secret = randomBytes(32);
      await writeFile(path, secret, { mode: 0o600 });
    }
  }
  return (shared = createLocalStore(root, secret));
}
