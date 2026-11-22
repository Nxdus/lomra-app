import { storage, storageFile } from '../storage';
import { saveSetting } from '../settings';
import type { CanvasHarness } from './canvas-harness';

export type CanvasImage = {
  id: string;
  file: File;
  x: number;
  y: number;
  width: number;
  height: number;
  harness?: CanvasHarness;
};

// Kept only to import existing browser data; server saves never overwrite it.
export async function localCanvasStorage(images?: CanvasImage[]): Promise<CanvasImage[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lomra-canvas", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("canvas");
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Canvas storage is blocked"));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("canvas", images ? "readwrite" : "readonly");
      const store = transaction.objectStore("canvas");
      const request = images ? store.put(images, "images") : store.get("images");
      transaction.oncomplete = () => resolve(images ?? request.result ?? []);
      transaction.onabort = () => reject(transaction.error ?? new Error("Canvas save aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export type SavedCanvasImage = Omit<CanvasImage, 'file'> & { name: string; type: string; lastModified: number };
const uploaded = new Set<string>();
const pendingFiles = new WeakSet<File>();
export const isCanvasFilePending = (file: File) => pendingFiles.has(file);

export async function loadCanvasFile(image: Pick<CanvasImage, 'id' | 'file'>) {
  const blob = await storageFile(image.id);
  if (!blob) throw new Error('Canvas file missing');
  return new File([blob], image.file.name, { type: image.file.type, lastModified: image.file.lastModified });
}
export async function deleteCanvasStorage(id: string) {
  // Remove the legacy copy first so deleting the original cannot reimport its images.
  if (id === 'default') {
    await localCanvasStorage([]);
  }
  await storage(`canvas/${encodeURIComponent(id)}`, 'DELETE');
}

export type CanvasHistoryItem = { id: string; count: number; name?: string };

export async function renameCanvas(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Canvas name cannot be empty.');
  await saveSetting(`canvas-name-${id}`, trimmed);
  return trimmed;
}

export async function canvasHistory(): Promise<CanvasHistoryItem[]> {
  const [rows, settings]: [{ id: string; value: SavedCanvasImage[] }[], { id: string; value: unknown }[]] = await Promise.all([storage('canvas'), storage('settings')]);
  return rows.map((row) => {
    const name = settings.find(setting => setting.id === `canvas-name-${row.id}`)?.value;
    return { id: row.id, count: row.value.length, ...(typeof name === 'string' && name.trim() ? { name } : {}) };
  }).sort((a, b) => (Number(b.id.split('-')[1]) || 0) - (Number(a.id.split('-')[1]) || 0));
}

export function canvasTitle(id: string) {
  return id === 'default' ? 'Original canvas' : `Canvas · ${new Date(Number(id.split('-')[1])).toLocaleString()}`;
}

async function saveCanvas(images: CanvasImage[], id: string) {
  for (const image of images) {
    if (!uploaded.has(image.id)) {
      await storageFile(image.id, image.file);
      uploaded.add(image.id);
    }
  }
  const manifest = images.map(({ file, id, x, y, width, height, harness }) => ({
    id, x, y, width, height, harness, name: file.name, type: file.type, lastModified: file.lastModified,
  }));
  await storage(`canvas/${encodeURIComponent(id)}`, 'PUT', manifest);
}

export async function canvasStorage(images?: CanvasImage[], id = 'default', layoutOnly = false): Promise<CanvasImage[]> {
  if (images !== undefined) {
    await saveCanvas(images, id);
    return images;
  }
  return (async () => {
    const rows: { id: string; value: SavedCanvasImage[] }[] = await storage('canvas');
    const saved = rows.find((row) => row.id === id);
    if (!saved) {
      if (id !== 'default') throw new Error('Canvas no longer exists');
      const legacy = await localCanvasStorage();
      await saveCanvas(legacy, id);
      return legacy;
    }
    if (layoutOnly) return saved.value.map(({ name, type, lastModified, ...item }) => {
      const file = new File([], name, { type, lastModified });
      pendingFiles.add(file);
      // These files already exist remotely; saving a layout must never upload empty placeholders.
      uploaded.add(item.id);
      return { ...item, file };
    });
    const restored: CanvasImage[] = new Array(saved.value.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, saved.value.length) }, async () => {
    while (cursor < saved.value.length) {
      const index = cursor++;
      const { name, type, lastModified, ...item } = saved.value[index];
      try {
        const blob = await storageFile(item.id);
        if (!blob) throw new Error('Canvas file missing');
        restored[index] = { ...item, file: new File([blob], name, { type, lastModified }) };
      } catch (error) {
        throw new Error(`Could not load ${name}. ${error instanceof Error ? error.message : 'Please retry.'}`);
      }
      uploaded.add(item.id);
    }
    }));
    return restored;
  })();
}

export function imageFileError(file: File): string | null {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    return "Use PNG, JPEG, WebP or GIF images.";
  }
  if (file.size > 20 * 1024 * 1024) return "Image exceeds 20 MB.";
  return null;
}

export function canvasFileKind(file: File): "image" | "video" | "3d" | null {
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return "image";
  if (["video/mp4", "video/webm"].includes(file.type) || ((!file.type || file.type === "application/octet-stream") && /\.(mp4|webm)$/i.test(file.name))) return "video";
  if (file.type === "model/gltf-binary" || /\.glb$/i.test(file.name)) return "3d";
  return null;
}

export function canvasFileError(file: File): string | null {
  const kind = canvasFileKind(file);
  if (kind === "image") return imageFileError(file);
  if (!kind) return "Use PNG, JPEG, WebP, GIF, MP4, WebM or GLB files.";
  const limit = 100;
  return file.size > limit * 1024 * 1024 ? `File exceeds ${limit} MB.` : null;
}

export async function canvasFileSize(file: File, url: string) {
  const kind = canvasFileKind(file);
  if (kind === "3d") {
    const header = await file.slice(0, 12).arrayBuffer();
    const view = new DataView(header);
    if (header.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== file.size) throw new Error("Invalid GLB file");
    return { width: 320, height: 320 };
  }
  if (kind === "video") {
    const video = document.createElement("video");
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error("Video metadata timed out")); }, 15_000);
        const cleanup = () => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; };
        video.onloadedmetadata = () => { cleanup(); resolve(); };
        video.onerror = () => { cleanup(); reject(new Error("Unsupported video")); };
        video.preload = "metadata";
        video.src = url;
      });
      if (!video.videoWidth || !video.videoHeight) throw new Error("Video has no picture");
      const size = displaySize(video.videoWidth, video.videoHeight);
      return { ...size, height: size.height + 28 };
    } finally {
      video.removeAttribute("src");
      video.load();
    }
  }
  const decoded = new Image();
  decoded.src = url;
  await decoded.decode();
  return displaySize(decoded.naturalWidth, decoded.naturalHeight);
}

export function displaySize(width: number, height: number) {
  const scale = Math.min(1, 320 / width, 320 / height);
  return { width: width * scale, height: height * scale };
}
