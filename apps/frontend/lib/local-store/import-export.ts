import { strFromU8, strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
import type { Storyboard } from '../../components/prompt/storyboard-data';
import type { LocalStore } from './store';
import { StoreError, validId, validateValue } from './validation';

const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 5000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PROJECT_FORMAT = 'lomra-project';
export const PROJECT_VERSION = 1;

export type SavedCanvasItem = {
  id: string;
  name: string;
  type: string;
  lastModified: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProjectManifest = {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: number;
  name: string;
  canvas: SavedCanvasItem[];
  camera?: { x: number; y: number; scale: number };
  chats?: unknown[];
};

function collectStoryboardFileIds(board: Storyboard | undefined): Set<string> {
  const ids = new Set<string>();
  if (!board) return ids;

  for (const char of board.characters ?? []) {
    if (char.generatedId && validId(char.generatedId)) ids.add(char.generatedId);
  }

  for (const shot of board.shots ?? []) {
    if (shot.generatedId && validId(shot.generatedId)) ids.add(shot.generatedId);
    if (shot.videoId && validId(shot.videoId)) ids.add(shot.videoId);
    if (shot.selectedTakeId && validId(shot.selectedTakeId)) ids.add(shot.selectedTakeId);
    for (const take of shot.takes ?? []) {
      if (take.fileId && validId(take.fileId)) ids.add(take.fileId);
    }
  }

  if (board.timeline) {
    for (const trim of board.timeline.trims ?? []) {
      if (trim.fileId && validId(trim.fileId)) ids.add(trim.fileId);
    }
    for (const audio of board.timeline.audio ?? []) {
      if (audio.fileId && validId(audio.fileId)) ids.add(audio.fileId);
    }
  }

  if (board.videoItemId && validId(board.videoItemId)) {
    ids.add(board.videoItemId);
  }

  return ids;
}

function collectChatFileIds(chat: unknown): Set<string> {
  const ids = new Set<string>();
  if (!chat || typeof chat !== 'object') return ids;
  const c = chat as {
    storyboard?: Storyboard;
    generations?: Array<{ files?: Array<{ url?: string }> }>;
  };

  for (const id of collectStoryboardFileIds(c.storyboard)) {
    ids.add(id);
  }

  for (const gen of c.generations ?? []) {
    for (const file of gen.files ?? []) {
      const match = file.url?.match(/^\/api\/storage\/files\/([\w-]+)$/);
      if (match && validId(match[1])) ids.add(match[1]);
    }
  }

  return ids;
}

function remapChat(chat: unknown, newChatId: string, newCanvasId: string, fileIdMap: Map<string, string>): unknown {
  if (!chat || typeof chat !== 'object') return chat;
  const raw = JSON.parse(JSON.stringify(chat)) as Record<string, unknown>;

  raw.id = newChatId;
  raw.canvasId = newCanvasId;
  delete raw.agentSession;

  const board = raw.storyboard as Storyboard | undefined;
  if (board) {
    for (const char of board.characters ?? []) {
      if (char.generatedId && fileIdMap.has(char.generatedId)) {
        char.generatedId = fileIdMap.get(char.generatedId);
      }
    }

    for (const shot of board.shots ?? []) {
      if (shot.generatedId && fileIdMap.has(shot.generatedId)) {
        shot.generatedId = fileIdMap.get(shot.generatedId);
      }
      if (shot.videoId && fileIdMap.has(shot.videoId)) {
        shot.videoId = fileIdMap.get(shot.videoId);
      }
      if (shot.selectedTakeId && fileIdMap.has(shot.selectedTakeId)) {
        shot.selectedTakeId = fileIdMap.get(shot.selectedTakeId);
      }
      for (const take of shot.takes ?? []) {
        if (take.fileId && fileIdMap.has(take.fileId)) {
          take.fileId = fileIdMap.get(take.fileId)!;
        }
      }
    }

    if (board.timeline) {
      for (const trim of board.timeline.trims ?? []) {
        if (trim.fileId && fileIdMap.has(trim.fileId)) {
          trim.fileId = fileIdMap.get(trim.fileId)!;
        }
      }
      for (const audio of board.timeline.audio ?? []) {
        if (audio.fileId && fileIdMap.has(audio.fileId)) {
          audio.fileId = fileIdMap.get(audio.fileId)!;
        }
      }
    }

    if (board.videoItemId && fileIdMap.has(board.videoItemId)) {
      board.videoItemId = fileIdMap.get(board.videoItemId);
    }
  }

  const generations = raw.generations as Array<{ files?: Array<{ url?: string }> }> | undefined;
  if (Array.isArray(generations)) {
    for (const gen of generations) {
      for (const file of gen.files ?? []) {
        const match = file.url?.match(/^\/api\/storage\/files\/([\w-]+)$/);
        if (match && fileIdMap.has(match[1])) {
          file.url = `/api/storage/files/${fileIdMap.get(match[1])}`;
        }
      }
    }
  }

  return raw;
}

export async function exportProject(
  store: LocalStore,
  canvasId: string,
): Promise<{ filename: string; archive: Uint8Array }> {
  if (!validId(canvasId)) throw new StoreError(400, 'Invalid canvas ID');

  const canvases = await store.list('canvas');
  const canvasRow = canvases.find((row) => row.id === canvasId);
  if (!canvasRow && canvasId !== 'default') {
    throw new StoreError(404, 'Canvas not found');
  }

  const canvasItems = (canvasRow?.value ?? []) as SavedCanvasItem[];

  const settings = await store.list('settings');
  const nameSetting = settings.find((row) => row.id === `canvas-name-${canvasId}`)?.value;
  const name = typeof nameSetting === 'string' && nameSetting.trim()
    ? nameSetting.trim()
    : (canvasId === 'default' ? 'Original canvas' : 'Canvas');

  const cameraKey = canvasId === 'default' ? 'camera' : `camera-${canvasId}`;
  const cameraSetting = settings.find((row) => row.id === cameraKey)?.value as { x: number; y: number; scale: number } | undefined;

  const allChats = await store.list('chats');
  const chats = allChats
    .filter((row) => ((row.value as { canvasId?: string }).canvasId ?? 'default') === canvasId)
    .map((row) => row.value);

  const fileIds = new Set<string>();
  for (const item of canvasItems) {
    if (item.id && validId(item.id)) fileIds.add(item.id);
  }
  for (const chat of chats) {
    for (const id of collectChatFileIds(chat)) {
      fileIds.add(id);
    }
  }

  const filesRecord: Record<string, Uint8Array> = {};
  for (const id of fileIds) {
    try {
      const data = await store.readFile(id);
      filesRecord[`files/${id}`] = new Uint8Array(data);
    } catch {
      const isCanvasItem = canvasItems.some((item) => item.id === id);
      if (isCanvasItem) {
        throw new StoreError(404, `Required canvas media file missing: ${id}`);
      }
    }
  }

  const manifest: ProjectManifest = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: Date.now(),
    name,
    canvas: canvasItems,
    ...(cameraSetting ? { camera: cameraSetting } : {}),
    chats,
  };

  const archiveEntries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    ...filesRecord,
  };

  const archive = Uint8Array.from(zipSync(archiveEntries, { level: 6 }));
  const safeName = name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'project';
  const filename = `${safeName}.lomra`;

  return { filename, archive };
}

export async function importProject(
  store: LocalStore,
  archiveBytes: Uint8Array,
): Promise<{ canvasId: string; name: string; itemCount: number }> {
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new StoreError(413, 'Project archive exceeds 600 MB limit');
  }
  if (!archiveBytes.byteLength) {
    throw new StoreError(400, 'Project archive is empty');
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(archiveBytes);
  } catch {
    throw new StoreError(400, 'Invalid project archive: Not a valid ZIP file');
  }

  const entries = Object.keys(unzipped);
  if (entries.length > MAX_ARCHIVE_FILES) {
    throw new StoreError(400, 'Project archive contains too many files');
  }

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      throw new StoreError(400, 'Project archive contains unsafe entry paths');
    }
    if (unzipped[entry].byteLength > MAX_FILE_BYTES) {
      throw new StoreError(400, `File "${entry}" exceeds 100 MB limit`);
    }
  }

  const manifestBytes = unzipped['manifest.json'] ?? unzipped['project.json'];
  if (!manifestBytes) {
    throw new StoreError(400, 'Invalid project archive: manifest.json missing');
  }

  let manifest: ProjectManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new StoreError(400, 'Invalid project archive: Corrupted manifest.json');
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new StoreError(400, 'Invalid project archive: Invalid manifest format');
  }

  if (!Array.isArray(manifest.canvas)) {
    throw new StoreError(400, 'Invalid project archive: Invalid canvas items');
  }

  const newCanvasId = `canvas-${Date.now()}-${crypto.randomUUID()}`;
  const fileIdMap = new Map<string, string>();

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('files/')) {
      const origId = normalized.slice(6);
      if (validId(origId) && !fileIdMap.has(origId)) {
        fileIdMap.set(origId, crypto.randomUUID());
      }
    }
  }

  for (const item of manifest.canvas) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
      throw new StoreError(400, 'Invalid canvas item');
    }
    if (!fileIdMap.has(item.id)) {
      throw new StoreError(400, `Archive is missing media file for "${item.name || item.id}"`);
    }
  }

  const newCanvasItems: SavedCanvasItem[] = manifest.canvas.map((item) => ({
    ...item,
    id: fileIdMap.get(item.id)!,
  }));

  validateValue('canvas', newCanvasId, newCanvasItems);

  const rawName = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : 'Imported canvas';
  const name = rawName.slice(0, 200);
  validateValue('settings', `canvas-name-${newCanvasId}`, name);

  const rawCamera = manifest.camera && typeof manifest.camera === 'object' ? manifest.camera : { x: 0, y: 0, scale: 1 };
  validateValue('settings', `camera-${newCanvasId}`, rawCamera);

  const chatsToSave: Array<{ id: string; value: unknown }> = [];
  for (const chat of manifest.chats ?? []) {
    const newChatId = crypto.randomUUID();
    const updated = remapChat(chat, newChatId, newCanvasId, fileIdMap);
    validateValue('chats', newChatId, updated);
    chatsToSave.push({ id: newChatId, value: updated });
  }

  // All validation passed; commit files and state to disk
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('files/')) {
      const origId = normalized.slice(6);
      const newId = fileIdMap.get(origId);
      if (newId) {
        const fileBytes = unzipped[entry];
        if (fileBytes.byteLength > 0) {
          await store.writeFile(newId, fileBytes);
        }
      }
    }
  }

  await store.save('canvas', newCanvasId, newCanvasItems);
  await store.save('settings', `canvas-name-${newCanvasId}`, name);
  await store.save('settings', `camera-${newCanvasId}`, rawCamera);
  for (const { id, value } of chatsToSave) {
    await store.save('chats', id, value);
  }

  return { canvasId: newCanvasId, name, itemCount: newCanvasItems.length };
}
