export class StoreError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const model = (value: unknown) => typeof value === 'string' && /^(llm|picture|video|3d):\S.{0,511}$/.test(value);
const canvasId = /^(default|canvas-\d{13}-[a-f0-9-]{36})$/;

export const kinds = ['chats', 'keys', 'canvas', 'settings'] as const;
export type Kind = (typeof kinds)[number];

export function validId(id: string) {
  return /^[\w-]{1,128}$/.test(id);
}

function validCanvas(id: string, value: unknown) {
  if (!canvasId.test(id) || !Array.isArray(value) || value.length > 5000) return false;
  const ids = new Set<string>();
  return value.every((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || !/^[\w-]{1,128}$/.test(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    return typeof item.name === 'string' && item.name.length <= 512 &&
      typeof item.type === 'string' && item.type.length <= 128 &&
      typeof item.lastModified === 'number' && Number.isSafeInteger(item.lastModified) && item.lastModified >= 0 &&
      ['x', 'y', 'width', 'height'].every((key) => finite(item[key])) &&
      (item.width as number) > 0 && (item.height as number) > 0;
  });
}

function validSetting(id: string, value: unknown) {
  if (/^canvas-name-(default|canvas-\d{13}-[a-f0-9-]{36})$/.test(id)) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
  }
  if (id === 'camera' || /^camera-canvas-\d{13}-[a-f0-9-]{36}$/.test(id)) {
    return record(value) && finite(value.x) && finite(value.y) &&
      typeof value.scale === 'number' && value.scale >= 0.2 && value.scale <= 4;
  }
  if (id === 'prompt-position') return record(value) && finite(value.x) && finite(value.y);
  if (id === 'selected-models') return Array.isArray(value) && value.length <= 4 && value.every(model);
  if (id === 'custom-models') {
    return Array.isArray(value) && value.length <= 500 && value.every((item: unknown) =>
      record(item) && model(item.value) && typeof item.name === 'string' &&
      item.name.trim().length > 0 && item.name.length <= 200 &&
      (item.capabilities === undefined || (Array.isArray(item.capabilities) &&
        item.capabilities.every((capability) => ['text-to-3d', 'image-to-3d', 'multi-view-to-3d'].includes(capability)))));
  }
  return false;
}

function validChat(id: string, value: unknown) {
  const chat = value as Record<string, unknown> | null;
  if (!chat || chat.id !== id ||
    (chat.canvasId !== undefined && (typeof chat.canvasId !== 'string' || !canvasId.test(chat.canvasId))) ||
    typeof chat.title !== 'string' || typeof chat.updatedAt !== 'number' || !Number.isFinite(chat.updatedAt) ||
    !Array.isArray(chat.history) || !Array.isArray(chat.generations) || !Array.isArray(chat.models)) return false;
  return chat.models.every((entry) => typeof entry === 'string') &&
    chat.history.every((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string') &&
    chat.generations.every((task) => task && ['picture', 'video', '3d'].includes(task.category) &&
      ['id', 'model', 'prompt', 'status'].every((field) => typeof task[field] === 'string') &&
      ['error', 'requestId'].every((field) => task[field] === undefined || typeof task[field] === 'string') &&
      (task.files === undefined || (Array.isArray(task.files) && task.files.every((file: Record<string, unknown>) =>
        file && typeof file.url === 'string' && typeof file.name === 'string' &&
        ['image', 'video', 'file'].includes(file.kind as string)))));
}

export function validateValue(kind: Kind, id: string, value: unknown) {
  if (!validId(id)) throw new StoreError(400, 'Invalid ID');
  if (kind === 'keys') {
    if (!['openrouter', 'fal'].includes(id) || typeof value !== 'string' || value.length > 512) throw new StoreError(400, 'Invalid key');
    return;
  }
  const valid = kind === 'canvas' ? validCanvas(id, value) : kind === 'settings' ? validSetting(id, value) : validChat(id, value);
  if (!valid) throw new StoreError(400, 'Invalid saved state');
}
