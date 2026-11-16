import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { savedData, savedFiles } from '../database/schema.js';
import { ObjectStorageService } from './object-storage.service.js';
import { AuthService } from '../auth/auth.service.js';
import { validateSavedState } from './storage.validation.js';

export function storageIdentity(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new UnauthorizedException();
  return {
    owner: createHash('sha256').update(token).digest('hex'),
    key: createHash('sha256').update(`lomra-api-keys:${token}`).digest(),
  };
}

export function encryptKey(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptKey(value: string, key: Buffer) {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString('utf8');
}

@Controller('storage/:kind')
export class StorageController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ObjectStorageService) private readonly objects: ObjectStorageService,
  ) {}

  private scope(token: string, kind: string, id?: string) {
    const identity = storageIdentity(token);
    if (
      !['chats', 'keys', 'settings', 'canvas'].includes(kind) ||
      (id !== undefined && (!id || id.length > 128))
    )
      throw new BadRequestException();
    return {
      ...identity,
      where: and(
        eq(savedData.owner, identity.owner),
        eq(savedData.kind, kind),
        id === undefined ? undefined : eq(savedData.id, id),
      ),
    };
  }

  @Get()
  async list(
    @Headers('x-storage-token') token: string,
    @Param('kind') kind: string,
    @Headers('cookie') cookie = '',
    @Headers('x-storage-account') account?: string,
  ) {
    const { key, where } = this.scope(
      await this.auth.storageToken(cookie, token, account),
      kind,
    );
    const rows = await this.database.db.select().from(savedData).where(where);
    return rows.map((row) => ({
      id: row.id,
      value: kind === 'keys' ? decryptKey(row.value as string, key) : row.value,
    }));
  }

  @Put(':id')
  async save(
    @Headers('x-storage-token') token: string,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { value?: unknown },
    @Headers('cookie') cookie = '',
    @Headers('x-storage-account') account?: string,
  ) {
    const { owner, key } = this.scope(
      await this.auth.storageToken(cookie, token, account),
      kind,
      id,
    );
    let value = body?.value;
    if (kind === 'keys') {
      if (
        !['openrouter', 'fal'].includes(id) ||
        typeof value !== 'string' ||
        value.length > 512
      )
        throw new BadRequestException();
      value = encryptKey(value.trim(), key);
    } else if (kind === 'settings' || kind === 'canvas') {
      validateSavedState(kind, id, value);
    } else {
      const chat = value as Record<string, unknown> | null;
      if (
        !chat ||
        chat.id !== id ||
        (chat.canvasId !== undefined &&
          (typeof chat.canvasId !== 'string' ||
            !/^(default|canvas-\d{13}-[a-f0-9-]{36})$/.test(chat.canvasId))) ||
        typeof chat.title !== 'string' ||
        typeof chat.updatedAt !== 'number' ||
        !Number.isFinite(chat.updatedAt) ||
        !Array.isArray(chat.history) ||
        !Array.isArray(chat.generations) ||
        !Array.isArray(chat.models)
      )
        throw new BadRequestException('Invalid chat');
      if (
        !chat.models.every((model) => typeof model === 'string') ||
        !chat.history.every(
          (message) =>
            message &&
            ['user', 'assistant'].includes(message.role) &&
            typeof message.content === 'string',
        ) ||
        !chat.generations.every(
          (task) =>
            task &&
            ['picture', 'video', '3d'].includes(task.category) &&
            ['id', 'model', 'prompt', 'status'].every(
              (field) => typeof task[field] === 'string',
            ) &&
            ['error', 'requestId'].every(
              (field) =>
                task[field] === undefined || typeof task[field] === 'string',
            ) &&
            (task.files === undefined ||
              (Array.isArray(task.files) &&
                task.files.every(
                  (file: Record<string, unknown>) =>
                    file &&
                    typeof file.url === 'string' &&
                    typeof file.name === 'string' &&
                    ['image', 'video', 'file'].includes(file.kind as string),
                ))),
        )
      )
        throw new BadRequestException('Invalid chat content');
    }
    await this.database.db
      .insert(savedData)
      .values({ owner, kind, id, value })
      .onConflictDoUpdate({
        target: [savedData.owner, savedData.kind, savedData.id],
        set: { value },
      });
    return { saved: true };
  }

  @Delete(':id')
  async remove(
    @Headers('x-storage-token') token: string,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Headers('cookie') cookie = '',
    @Headers('x-storage-account') account?: string,
  ) {
    const { owner, where } = this.scope(
      await this.auth.storageToken(cookie, token, account),
      kind,
      id,
    );
    if (kind === 'canvas') {
      const rows = await this.database.db.select().from(savedData)
        .where(and(eq(savedData.owner, owner), inArray(savedData.kind, ['canvas', 'chats'])));
      const canvas = rows.find((row) => row.kind === 'canvas' && row.id === id);
      const otherFiles = new Set(rows.filter((row) => row.kind === 'canvas' && row.id !== id)
        .flatMap((row) => (row.value as { id: string }[]).map((item) => item.id)));
      const files = [...new Set(((canvas?.value ?? []) as { id: string }[]).map((item) => item.id))]
        .filter((file) => !otherFiles.has(file));
      // Keep the manifest until object deletion succeeds so failed cleanup can be retried.
      for (const file of files) await this.objects.remove(owner, file);
      const chats = rows.filter((row) => row.kind === 'chats' &&
        ((row.value as { canvasId?: string }).canvasId ?? 'default') === id).map((row) => row.id);
      await this.database.db.transaction(async (tx) => {
        if (files.length) await tx.delete(savedFiles).where(and(eq(savedFiles.owner, owner), inArray(savedFiles.id, files)));
        await tx.delete(savedData).where(and(eq(savedData.owner, owner), or(
          and(eq(savedData.kind, 'canvas'), eq(savedData.id, id)),
          and(eq(savedData.kind, 'settings'), eq(savedData.id, id === 'default' ? 'camera' : `camera-${id}`)),
          and(eq(savedData.kind, 'settings'), eq(savedData.id, `canvas-name-${id}`)),
          chats.length ? and(eq(savedData.kind, 'chats'), inArray(savedData.id, chats)) : undefined,
        )));
      });
      return { deleted: true };
    }
    await this.database.db.delete(savedData).where(where);
    return { deleted: true };
  }
}
