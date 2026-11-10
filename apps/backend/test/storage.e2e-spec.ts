import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { StorageModule } from '../src/storage/storage.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  savedData,
  savedFiles,
  session,
  user,
} from '../src/database/schema.js';
import { accountStorageToken } from '../src/auth/auth.service.js';
import { storageIdentity } from '../src/storage/storage.controller.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ObjectStorageService } from '../src/storage/object-storage.service.js';

// Opt in against the configured local PostgreSQL; cleanup only these random test identities.
describe.skipIf(process.env.STORAGE_INTEGRATION !== '1')(
  'account storage (PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let database: DatabaseService;
    const users = [randomUUID(), randomUUID()];
    const secret =
      process.env.BETTER_AUTH_SECRET ??
      'unused-when-integration-tests-are-skipped';
    const guestToken = randomBytes(32).toString('hex');
    const tokens = [
      randomBytes(32).toString('hex'),
      randomBytes(32).toString('hex'),
      randomBytes(32).toString('hex'),
    ];
    const cookies = tokens.map(
      (token) =>
        `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)}`,
    );
    const owners = [
      ...users.map(
        (id) => storageIdentity(accountStorageToken(id, secret)).owner,
      ),
      storageIdentity(guestToken).owner,
    ];

    beforeAll(async () => {
      const module = await Test.createTestingModule({
        imports: [StorageModule],
      }).compile();
      app = module.createNestApplication<NestExpressApplication>({
        logger: false,
        bodyParser: false,
      });
      app.useBodyParser('json');
      app.useBodyParser('raw', {
        type: 'application/octet-stream',
        limit: '100mb',
      });
      await app.init();
      database = app.get(DatabaseService);
      await database.db.insert(user).values(
        users.map((id) => ({
          id,
          email: `${id}@example.invalid`,
          name: 'Storage test',
          emailVerified: true,
        })),
      );
      await database.db.insert(session).values(
        tokens.map((token, index) => ({
          id: randomUUID(),
          token,
          userId: users[index === 2 ? 1 : 0],
          expiresAt: new Date(Date.now() + 60_000),
        })),
      );
    });

    afterAll(async () => {
      if (app) {
        const objects = app.get(ObjectStorageService);
        for (const owner of owners) for (const id of ['file-1', 'guest-file', 'legacy-file']) {
          await objects.client.send(new DeleteObjectCommand({ Bucket: objects.bucket, Key: `${owner}/${id}` }));
        }
      }
      if (database) {
        await database.db
          .delete(savedData)
          .where(inArray(savedData.owner, owners));
        await database.db
          .delete(savedFiles)
          .where(inArray(savedFiles.owner, owners));
        await database.db.delete(user).where(inArray(user.id, users));
      }
      await app?.close();
    });

    it('restores files, layout, settings and chats in a second session and isolates other accounts', async () => {
      const bytes = Buffer.from([0, 1, 2, 128, 255]);
      const manifest = [
        {
          id: 'file-1',
          name: 'test.png',
          type: 'image/png',
          lastModified: 123,
          x: 5,
          y: -10,
          width: 120,
          height: 80,
        },
      ];
      const send = (
        method: 'get' | 'put',
        path: string,
        cookie: string,
        account: string,
      ) =>
        request(app.getHttpServer())
          [method](path)
          .set('Cookie', cookie)
          .set('x-storage-token', guestToken)
          .set('x-storage-account', account);
      await send('put', '/storage/files/file-1', cookies[0], users[0])
        .type('application/octet-stream')
        .send(bytes)
        .expect(200);
      await send('put', '/storage/canvas/default', cookies[0], users[0])
        .send({ value: manifest })
        .expect(200);
      await send('put', '/storage/settings/camera', cookies[0], users[0])
        .send({ value: { x: 10, y: 20, scale: 1.5 } })
        .expect(200);
      await send('put', '/storage/settings/custom-models', cookies[0], users[0])
        .send({ value: [{ value: 'llm:test/model', name: 'Test' }] })
        .expect(200);
      await send('put', '/storage/chats/chat-1', cookies[0], users[0])
        .send({
          value: {
            id: 'chat-1',
            title: 'Test chat',
            updatedAt: 1,
            history: [{ role: 'user', content: 'Hello' }],
            generations: [],
            models: [],
          },
        })
        .expect(200);

      const file = await send(
        'get',
        '/storage/files/file-1',
        cookies[1],
        users[0],
      ).expect(200);
      expect(Buffer.from(await (await fetch(file.body.url)).arrayBuffer())).toEqual(bytes);
      expect((await fetch(file.body.url.split('?')[0])).status).toBe(403);
      await send('put', '/storage/files/file-1', cookies[0], users[0])
        .type('application/octet-stream').send(Buffer.from('replacement')).expect(200);
      expect(Buffer.from(await (await fetch(file.body.url)).arrayBuffer())).toEqual(bytes);
      await database.db.insert(savedFiles).values({ owner: owners[0], id: 'legacy-file', data: bytes });
      const legacy = await send('get', '/storage/files/legacy-file', cookies[0], users[0]).expect(200);
      expect(Buffer.from(await (await fetch(legacy.body.url)).arrayBuffer())).toEqual(bytes);
      expect(
        (await send('get', '/storage/canvas', cookies[1], users[0]).expect(200))
          .body[0].value,
      ).toEqual(manifest);
      expect(
        (
          await send('get', '/storage/settings', cookies[1], users[0]).expect(
            200,
          )
        ).body,
      ).toHaveLength(2);
      expect(
        (await send('get', '/storage/chats', cookies[1], users[0]).expect(200))
          .body[0].value.title,
      ).toBe('Test chat');
      for (const kind of ['canvas', 'settings', 'chats'])
        expect(
          (
            await send('get', `/storage/${kind}`, cookies[2], users[1]).expect(
              200,
            )
          ).body,
        ).toEqual([]);
      await send('get', '/storage/files/file-1', cookies[2], users[1]).expect(
        404,
      );
      await send('put', '/storage/settings/camera', cookies[2], users[0])
        .send({ value: { x: 0, y: 0, scale: 1 } })
        .expect(401);
      await send('put', '/storage/canvas/default', cookies[0], users[0])
        .send({ value: [{ ...manifest[0], width: -1 }] })
        .expect(400);
    });

    it('imports guest data once, re-encrypts keys, merges canvas and never shares it with another account', async () => {
      const send = (
        method: 'get' | 'put',
        path: string,
        cookie = '',
        account = 'guest',
      ) =>
        request(app.getHttpServer())
          [method](path)
          .set('Cookie', cookie)
          .set('x-storage-token', guestToken)
          .set('x-storage-account', account);
      await send('put', '/storage/keys/fal')
        .send({ value: 'guest-fal-key' })
        .expect(200);
      await send('put', '/storage/keys/openrouter')
        .send({ value: 'guest-openrouter-key' })
        .expect(200);
      await send('put', '/storage/keys/openrouter', cookies[0], users[0])
        .send({ value: 'existing-account-key' })
        .expect(200);
      await send('put', '/storage/chats/guest-chat')
        .send({
          value: {
            id: 'guest-chat',
            title: 'Guest history',
            updatedAt: 2,
            history: [],
            generations: [],
            models: [],
          },
        })
        .expect(200);
      await send('put', '/storage/files/guest-file')
        .type('application/octet-stream')
        .send(Buffer.from('guest-file-bytes'))
        .expect(200);
      await send('put', '/storage/canvas/default')
        .send({
          value: [
            {
              id: 'guest-file',
              name: 'guest.png',
              type: 'image/png',
              lastModified: 0,
              x: 1,
              y: 2,
              width: 10,
              height: 10,
            },
          ],
        })
        .expect(200);
      const claim = (cookie: string, origin = process.env.BETTER_AUTH_URL!) =>
        request(app.getHttpServer())
          .post('/storage/import-guest')
          .set('Cookie', cookie)
          .set('Origin', origin)
          .set('x-storage-token', guestToken);
      await claim('').expect(401);
      await claim(cookies[0], 'https://attacker.example').expect(403);
      expect((await claim(cookies[0]).expect(201)).body.imported).toBe(true);
      expect((await claim(cookies[1]).expect(201)).body.imported).toBe(false);
      expect((await claim(cookies[2]).expect(201)).body.imported).toBe(false);
      const keys = (
        await send('get', '/storage/keys', cookies[1], users[0]).expect(200)
      ).body;
      expect(keys.find((key: { id: string }) => key.id === 'fal').value).toBe(
        'guest-fal-key',
      );
      expect(
        keys.find((key: { id: string }) => key.id === 'openrouter').value,
      ).toBe('existing-account-key');
      expect(
        (await send('get', '/storage/canvas', cookies[1], users[0]).expect(200))
          .body[0].value,
      ).toHaveLength(2);
      const importedFile = await send(
            'get',
            '/storage/files/guest-file',
            cookies[1],
            users[0],
          ).expect(200);
      expect(await (await fetch(importedFile.body.url)).text()).toBe('guest-file-bytes');
      expect(
        (await send('get', '/storage/chats', cookies[1], users[0]).expect(200))
          .body,
      ).toHaveLength(2);
      expect(
        (await send('get', '/storage/keys', cookies[2], users[1]).expect(200))
          .body,
      ).toEqual([]);
      expect(
        (await send('get', '/storage/keys').expect(200)).body,
      ).toHaveLength(2);
      const encrypted = await database.db
        .select()
        .from(savedData)
        .where(inArray(savedData.owner, owners));
      const fal = encrypted.filter(
        (row) => row.kind === 'keys' && row.id === 'fal',
      );
      expect(fal).toHaveLength(2);
      expect(fal[0].value).not.toBe(fal[1].value);
    });
  },
);
