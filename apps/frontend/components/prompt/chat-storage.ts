import type { ConversationMessage, GeneratedFile, Generation } from "./generation";
import type { Storyboard } from "./storyboard-data";
import { storage, storageFile } from "@/lib/storage";

export type Chat = {
  id: string;
  canvasId?: string;
  title: string;
  updatedAt: number;
  history: ConversationMessage[];
  generations: Generation[];
  models: string[];
  storyboard?: Storyboard;
  /** Local agent session, so the next message continues the same conversation. */
  agentSession?: { engine: "claude" | "codex" | "opencode"; id: string; modelId?: string };
};

// Store each conversation independently so other tabs cannot overwrite the whole list.
async function localChats(change?: Chat | string): Promise<Chat[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lomra-chats", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("chats", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Chat storage is blocked. Close other Lomra windows and retry."));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("chats", change === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("chats");
      if (typeof change === "string") store.delete(change);
      else if (change) store.put(change);
      const request = store.getAll();
      transaction.oncomplete = () => resolve((request.result as Chat[]).sort((a, b) => b.updatedAt - a.updatedAt));
      transaction.onabort = () => reject(transaction.error ?? new Error("Chat save aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

let migration: Promise<void> | undefined;
const savedFiles = new WeakMap<GeneratedFile, Promise<GeneratedFile>>();

async function persistChatFiles(chat: Chat): Promise<Chat> {
  return { ...chat, generations: await Promise.all(chat.generations.map(async task => ({
    ...task, ...(task.files ? { files: await Promise.all(task.files.map(file => {
      if (file.kind !== "file" || (!file.url.startsWith("data:") && !file.url.startsWith("blob:"))) return file;
      let saved = savedFiles.get(file);
      if (!saved) {
        saved = persistentUrl(file.url, true).then(url => ({ ...file, url })).catch(error => { savedFiles.delete(file); throw error; });
        savedFiles.set(file, saved);
      }
      return saved;
    })) } : {}),
  }))) };
}

export async function chatStorage(change?: Chat | string, canvasId = "default"): Promise<Chat[]> {
  migration ??= (async () => {
    if (localStorage.getItem('lomra-chats-migrated')) return;
    const existing: { id: string }[] = await storage('chats');
    for (const chat of await localChats()) {
      if (!existing.some((row) => row.id === chat.id)) await storage(`chats/${encodeURIComponent(chat.id)}`, 'PUT', await persistChatFiles(chat));
    }
    localStorage.setItem('lomra-chats-migrated', 'true');
  })().catch((error) => { migration = undefined; throw error; });
  await migration;
  if (typeof change === 'string') await storage(`chats/${encodeURIComponent(change)}`, 'DELETE');
  else if (change) await storage(`chats/${encodeURIComponent(change.id)}`, 'PUT', await persistChatFiles(change));
  const rows: { value: Chat }[] = await storage('chats');
  return rows.map((row) => row.value).filter((chat) => (chat.canvasId ?? 'default') === canvasId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function restoreGenerations(generations: Generation[]): Generation[] {
  return generations.map((task) => task.status === "Done" || task.status === "Completed" || task.error ? task : {
    ...task, status: "Interrupted", error: task.requestId ? "Reopen the existing job with Check job." : "Interrupted before a job ID was saved. You can try again.",
  });
}

export async function persistentUrl(url: string, binary = false): Promise<string> {
  if (binary && (url.startsWith("blob:") || url.startsWith("data:"))) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not read generated file.");
    const blob = await response.blob();
    const id = crypto.randomUUID();
    await storageFile(id, new File([blob], "GLB.glb", { type: "model/gltf-binary" }));
    return `/api/storage/files/${id}`;
  }
  if (!url.startsWith("blob:")) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
