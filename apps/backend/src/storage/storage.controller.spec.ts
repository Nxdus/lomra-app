import { randomBytes } from 'node:crypto';
import {
  StorageController,
  decryptKey,
  encryptKey,
  storageIdentity,
} from './storage.controller.js';
import { DatabaseService } from '../database/database.service.js';
import { AuthService } from '../auth/auth.service.js';
import { ObjectStorageService } from './object-storage.service.js';
import { savedData, savedFiles } from '../database/schema.js';

describe('anonymous storage', () => {
  it('rejects missing or guessable identities', () => {
    expect(() => storageIdentity('')).toThrow();
    expect(() => storageIdentity('user-1')).toThrow();
  });

  it('encrypts keys with authenticated encryption bound to the browser secret', () => {
    const first = storageIdentity(randomBytes(32).toString('hex'));
    const second = storageIdentity(randomBytes(32).toString('hex'));
    const encrypted = encryptKey('test-api-key', first.key);
    expect(encrypted).not.toContain('test-api-key');
    expect(decryptKey(encrypted, first.key)).toBe('test-api-key');
    expect(() => decryptKey(encrypted, second.key)).toThrow();
    expect(encryptKey('test-api-key', first.key)).not.toBe(encrypted);
    expect(first.owner).not.toBe(second.owner);
  });

  it('rejects malformed writes before accessing the database', async () => {
    const controller = new StorageController(
      {} as DatabaseService,
      {
        storageToken: async (_cookie: string, token: string) => token,
      } as AuthService,
      {} as ObjectStorageService,
    );
    const token = randomBytes(32).toString('hex');
    await expect(
      controller.save(token, 'keys', 'unknown', { value: 'secret' }),
    ).rejects.toThrow();
    await expect(
      controller.save(token, 'keys', 'fal', { value: 12 }),
    ).rejects.toThrow();
    await expect(
      controller.save(token, 'chats', 'a', { value: { id: 'b' } }),
    ).rejects.toThrow();
    await expect(
      controller.save(token, 'chats', 'a', {
        value: {
          id: 'a',
          canvasId: {},
          title: 'Chat',
          updatedAt: 1,
          history: [],
          generations: [],
          models: [],
        },
      }),
    ).rejects.toThrow('Invalid chat');
    await expect(controller.list(token, 'unknown')).rejects.toThrow();
    await expect(
      controller.save(token, 'chats', 'a', {
        value: {
          id: 'a',
          title: 'Chat',
          updatedAt: 1,
          history: [null],
          generations: [],
          models: [],
        },
      }),
    ).rejects.toThrow('Invalid chat content');
  });

  it('deletes canvas files, chats and camera but preserves shared files', async () => {
    const rows = [
      { kind: 'canvas', id: 'default', value: [{ id: 'private' }, { id: 'shared' }] },
      { kind: 'canvas', id: 'other', value: [{ id: 'shared' }] },
      { kind: 'chats', id: 'legacy-chat', value: {} },
      { kind: 'chats', id: 'other-chat', value: { canvasId: 'other' } },
    ];
    const deleted: unknown[] = [];
    const tx = { delete: (table: unknown) => ({ where: async () => { deleted.push(table); } }) };
    const objects = { remove: vi.fn().mockResolvedValue(undefined) };
    const controller = new StorageController({ db: {
      select: () => ({ from: () => ({ where: async () => rows }) }),
      transaction: async (run: (db: typeof tx) => Promise<void>) => run(tx),
    } } as unknown as DatabaseService, {
      storageToken: async (_cookie: string, token: string) => token,
    } as AuthService, objects as unknown as ObjectStorageService);
    const token = randomBytes(32).toString('hex');
    await controller.remove(token, 'canvas', 'default');
    expect(objects.remove).toHaveBeenCalledExactlyOnceWith(storageIdentity(token).owner, 'private');
    expect(deleted).toEqual([savedFiles, savedData]);

    deleted.length = 0;
    objects.remove.mockRejectedValueOnce(new Error('Storage offline'));
    await expect(controller.remove(token, 'canvas', 'default')).rejects.toThrow('Storage offline');
    expect(deleted).toEqual([]);
  });
});
