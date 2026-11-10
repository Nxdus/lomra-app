import {
  Controller,
  ForbiddenException,
  Headers as RequestHeaders,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuthService, accountStorageToken } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { savedData } from '../database/schema.js';
import { ObjectStorageService } from './object-storage.service.js';
import {
  decryptKey,
  encryptKey,
  storageIdentity,
} from './storage.controller.js';

@Controller('storage/import-guest')
export class StorageImportController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ObjectStorageService) private readonly objects: ObjectStorageService,
  ) {}

  @Post()
  async importGuest(
    @RequestHeaders('cookie') cookie = '',
    @RequestHeaders('x-storage-token') token: string,
    @RequestHeaders('origin') origin: string,
  ) {
    if (origin !== process.env.BETTER_AUTH_URL) throw new ForbiddenException();
    const session = await this.auth.auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new UnauthorizedException();
    const guest = storageIdentity(token);
    const account = storageIdentity(
      accountStorageToken(session.user.id, process.env.BETTER_AUTH_SECRET!),
    );
    return this.database.db.transaction(async (transaction) => {
      // A browser's guest data may be claimed by only one account, including concurrent sign-ins.
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${guest.owner}, 0))`,
      );
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${'account:' + account.owner}, 0))`,
      );
      const [claim] = await transaction
        .select()
        .from(savedData)
        .where(
          and(
            eq(savedData.owner, guest.owner),
            eq(savedData.kind, 'guest-import'),
            eq(savedData.id, 'account'),
          ),
        );
      if (claim) return { imported: false };
      const rows = await transaction
        .select()
        .from(savedData)
        .where(
          and(
            eq(savedData.owner, guest.owner),
            inArray(savedData.kind, ['keys', 'chats', 'canvas', 'settings']),
          ),
        );
      if (!rows.length) return { imported: false };
      const existing = await transaction
        .select()
        .from(savedData)
        .where(eq(savedData.owner, account.owner));
      const newAccount = !existing.some(
        (row) =>
          row.kind === 'keys' ||
          row.kind === 'chats' ||
          ((row.kind === 'canvas' ||
            (row.kind === 'settings' && row.id === 'custom-models')) &&
            Array.isArray(row.value) &&
            row.value.length > 0),
      );
      await transaction.execute(
        sql`INSERT INTO saved_files (owner, id, data) SELECT ${account.owner}, id, data FROM saved_files WHERE owner = ${guest.owner} ON CONFLICT DO NOTHING`,
      );
      for (const row of rows) {
        let value = row.value;
        if (row.kind === 'keys')
          value = encryptKey(
            decryptKey(value as string, guest.key),
            account.key,
          );
        if (row.kind === 'canvas') {
          const current = existing.find(
            (item) => item.kind === 'canvas' && item.id === row.id,
          )?.value as { id: string }[] | undefined;
          const items = value as { id: string }[];
          for (const item of items) {
            if (!current?.some((saved) => saved.id === item.id)) {
              await this.objects.copy(guest.owner, account.owner, item.id);
            }
          }
          value = [
            ...(current ?? []),
            ...items.filter(
              (item) => !current?.some((saved) => saved.id === item.id),
            ),
          ];
        }
        const insert = transaction
          .insert(savedData)
          .values({ owner: account.owner, kind: row.kind, id: row.id, value });
        if (row.kind === 'canvas' || (row.kind === 'settings' && newAccount)) {
          await insert.onConflictDoUpdate({
            target: [savedData.owner, savedData.kind, savedData.id],
            set: { value },
          });
        } else {
          await insert.onConflictDoNothing();
        }
      }
      await transaction.insert(savedData).values({
        owner: guest.owner,
        kind: 'guest-import',
        id: 'account',
        value: session.user.id,
      });
      return { imported: true };
    });
  }
}
