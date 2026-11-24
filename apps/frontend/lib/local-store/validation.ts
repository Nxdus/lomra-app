import { parseOllamaUrl } from '../ollama-url';
import { validStoryboard } from '../../components/prompt/storyboard-data';
import { characterImageLimit, characterImageType, characterNameLimit, characterNamePattern, characterNotesLimit } from '../characters';
import { referenceSetNameLimit } from '../reference-sets';
import { validSdSettings, validSdUsed } from '../sd-settings';
import { MAX_MEDIA_ITEMS } from '../../components/prompt/media';
import { canvasCardType, canvasLinkLimit, canvasRelations, canvasRoles, canvasTextLimit, canvasTitleLimit } from '../image-canvas/canvas-harness';

export class StoreError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e13;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const model = (value: unknown) => typeof value === 'string' && /^(llm|picture|video|3d):\S.{0,511}$/.test(value);
const canvasId = /^(default|canvas-\d{13}-[a-f0-9-]{36})$/;

export const kinds = ['chats', 'keys', 'canvas', 'settings', 'characters', 'reference-sets'] as const;
export type Kind = (typeof kinds)[number];

export function validId(id: string) {
  return /^[\w-]{1,128}$/.test(id);
}

const bounded = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const oneOf = (value: unknown, options: readonly string[]) => typeof value === 'string' && options.includes(value);

function validCanvasSources(value: unknown) {
  return Array.isArray(value) && value.length <= 10 && value.every(source =>
    record(source) && typeof source.id === 'string' && validId(source.id) && bounded(source.name, 512));
}

function validHarness(value: unknown, id: string, ids: Set<string>, card: boolean) {
  if (value === undefined) return !card;
  if (!record(value)) return false;
  const { role, title, notes, links, provenance } = value;
  if (card || role !== undefined) {
    if (!oneOf(role, canvasRoles)) return false;
  }
  if (card || title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.length > canvasTitleLimit) return false;
  }
  if (notes !== undefined && !bounded(notes, canvasTextLimit)) return false;
  if (provenance !== undefined && (!record(provenance) || !bounded(provenance.model, 512) ||
    !bounded(provenance.prompt, canvasTextLimit) ||
    (provenance.selectedInputs !== undefined && !validCanvasSources(provenance.selectedInputs)) ||
    (provenance.sd !== undefined && !validSdUsed(provenance.sd)))) return false;
  if (links === undefined) return true;
  if (!Array.isArray(links) || links.length > canvasLinkLimit) return false;
  const seen = new Set<string>();
  return links.every(link => {
    if (!record(link) || typeof link.to !== 'string' || link.to === id || !ids.has(link.to) ||
      !oneOf(link.relation, canvasRelations)) return false;
    const key = `${link.to}:${link.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validCanvas(id: string, value: unknown) {
  if (!canvasId.test(id) || !Array.isArray(value) || value.length > 5000) return false;
  const ids = new Set<string>();
  const validItems = value.every((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || !validId(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    return typeof item.name === 'string' && item.name.length <= 512 &&
      typeof item.type === 'string' && item.type.length <= 128 &&
      typeof item.lastModified === 'number' && Number.isSafeInteger(item.lastModified) && item.lastModified >= 0 &&
      ['x', 'y', 'width', 'height'].every((key) => finite(item[key])) &&
      (item.width as number) > 0 && (item.height as number) > 0;
  });
  return validItems && value.every(item => validHarness(item.harness, item.id, ids, item.type === canvasCardType));
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
  if (id === 'chat-engine') return typeof value === 'string' && ['openrouter', 'claude', 'codex', 'opencode'].includes(value);
  if (id === 'google-usage') {
    return record(value) && typeof value.month === 'string' && /^\d{4}-\d{2}$/.test(value.month) &&
      ['requests', 'inputTokens', 'outputTokens'].every((field) => finite(value[field]) && (value[field] as number) >= 0);
  }
  if (id === 'agent-limits') {
    return record(value) && Object.entries(value).every(([agent, saved]) => agent === 'claude' && record(saved) && time(saved.updatedAt) &&
      Array.isArray(saved.windows) && saved.windows.length <= 8 && saved.windows.every((window: unknown) => record(window) &&
        typeof window.id === 'string' && typeof window.label === 'string' && finite(window.usedPercent) && time(window.resetsAt)));
  }
  if (id === 'disabled-agents') return Array.isArray(value) && value.length <= 20 && value.every((agent) => typeof agent === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(agent));
  if (id === 'ollama-url') return typeof value === 'string' && value.length <= 200 && parseOllamaUrl(value) === value;
  if (id === 'sd-settings') return validSdSettings(value);
  if (id === 'speech-model') return typeof value === 'string' && /^[a-z0-9-]{1,32}$/.test(value);
  if (id === 'agent-effort') {
    return record(value) && Object.entries(value).every(([agent, level]) => ['claude', 'codex'].includes(agent) && typeof level === 'string' && /^[a-z]{3,8}$/.test(level));
  }
  if (id === 'selected-models') return Array.isArray(value) && value.length <= 4 && value.every(model);
  if (id === 'hidden-models') return Array.isArray(value) && value.length <= 500 && value.every(model);
  if (id === 'custom-models') {
    return Array.isArray(value) && value.length <= 500 && value.every((item: unknown) =>
      record(item) && model(item.value) && typeof item.name === 'string' &&
      item.name.trim().length > 0 && item.name.length <= 200 &&
      (item.capabilities === undefined || (Array.isArray(item.capabilities) &&
        item.capabilities.every((capability) => ['text-to-3d', 'image-to-3d', 'multi-view-to-3d'].includes(capability)))));
  }
  return false;
}

function validReferenceImage(image: unknown) {
  return record(image) && typeof image.name === 'string' && image.name.length <= 512 &&
    typeof image.url === 'string' && image.url.length <= 1024 * 1024 && /^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]+={0,2})$/.test(image.url);
}

function validReferenceSet(id: string, value: unknown) {
  return record(value) && value.id === id && typeof value.name === 'string' &&
    value.name.trim().length > 0 && value.name.length <= referenceSetNameLimit &&
    Array.isArray(value.images) && value.images.length > 0 && value.images.length <= MAX_MEDIA_ITEMS &&
    value.images.every(validReferenceImage) && new Set(value.images.map(({ url }) => url)).size === value.images.length;
}

function validChat(id: string, value: unknown) {
  const chat = value as Record<string, unknown> | null;
  if (!chat || chat.id !== id ||
    (chat.canvasId !== undefined && (typeof chat.canvasId !== 'string' || !canvasId.test(chat.canvasId))) ||
    typeof chat.title !== 'string' || typeof chat.updatedAt !== 'number' || !Number.isFinite(chat.updatedAt) ||
    (chat.agentSession !== undefined && !(record(chat.agentSession) && ['claude', 'codex', 'opencode'].includes(chat.agentSession.engine as string) && typeof chat.agentSession.id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/.test(chat.agentSession.id) &&
      (chat.agentSession.modelId === undefined || (typeof chat.agentSession.modelId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,122}(?:\[1m\])?$/.test(chat.agentSession.modelId))))) ||
    !Array.isArray(chat.history) || !Array.isArray(chat.generations) || !Array.isArray(chat.models)) return false;
  return (chat.storyboard === undefined || validStoryboard(chat.storyboard, Array.isArray(chat.history[0]?.images) ? chat.history[0].images.length : 0)) &&
    chat.models.every((entry) => typeof entry === 'string') &&
    chat.history.every((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' &&
      (message.display === undefined || (message.role === 'user' && typeof message.display === 'string' && message.display.length <= 8100)) &&
      (message.images === undefined || (message.role === 'user' && Array.isArray(message.images) && message.images.length <= MAX_MEDIA_ITEMS &&
        message.images.every(validReferenceImage)))) &&
    chat.generations.every((task) => task && ['picture', 'video', '3d'].includes(task.category) &&
      ['id', 'model', 'prompt', 'status'].every((field) => typeof task[field] === 'string') &&
      (task.canvasInputs === undefined || validCanvasSources(task.canvasInputs)) &&
      (task.sd === undefined || validSdUsed(task.sd)) &&
      ['error', 'requestId'].every((field) => task[field] === undefined || typeof task[field] === 'string') &&
      (task.files === undefined || (Array.isArray(task.files) && task.files.every((file: Record<string, unknown>) =>
        file && typeof file.url === 'string' && typeof file.name === 'string' &&
        ['image', 'video', 'file'].includes(file.kind as string)))));
}

function validCharacter(id: string, value: unknown) {
  if (!record(value)) return false;
  const { additionalImageTypes, coverIndex } = value;
  if (additionalImageTypes !== undefined && (!Array.isArray(additionalImageTypes) ||
    additionalImageTypes.length >= characterImageLimit ||
    !additionalImageTypes.every(type => typeof type === 'string' && characterImageType.test(type)))) return false;
  if (coverIndex !== undefined && (typeof coverIndex !== 'number' || !Number.isInteger(coverIndex) ||
    coverIndex < 0 || coverIndex >= 1 + (additionalImageTypes?.length ?? 0))) return false;
  return /^character-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(id) &&
    value.id === id &&
    typeof value.name === 'string' && value.name.length <= characterNameLimit && characterNamePattern.test(value.name) &&
    typeof value.notes === 'string' && value.notes.length <= characterNotesLimit &&
    typeof value.imageType === 'string' && characterImageType.test(value.imageType);
}

export function validateValue(kind: Kind, id: string, value: unknown) {
  if (!validId(id)) throw new StoreError(400, 'Invalid ID');
  if (kind === 'keys') {
    if (!['openrouter', 'fal', 'google'].includes(id) || typeof value !== 'string' || value.length > 512) throw new StoreError(400, 'Invalid key');
    return;
  }
  const valid = kind === 'canvas' ? validCanvas(id, value)
    : kind === 'settings' ? validSetting(id, value)
    : kind === 'characters' ? validCharacter(id, value)
    : kind === 'reference-sets' ? validReferenceSet(id, value)
    : validChat(id, value);
  if (!valid) throw new StoreError(400, 'Invalid saved state');
}
