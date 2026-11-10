import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { savedFiles } from '../database/schema.js';
import { storageIdentity } from './storage.controller.js';
import { ObjectStorageService } from './object-storage.service.js';

@Controller('storage/files')
export class StorageFilesController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ObjectStorageService) private readonly objects: ObjectStorageService,
  ) {}

  private async owner(
    id: string,
    cookie: string,
    token: string,
    account?: string,
  ) {
    if (!/^[\w-]{1,128}$/.test(id))
      throw new BadRequestException('Invalid file ID');
    return storageIdentity(await this.auth.storageToken(cookie, token, account))
      .owner;
  }

  @Get(':id')
  async read(
    @Param('id') id: string,
    @Headers('cookie') cookie = '',
    @Headers('x-storage-token') token: string,
    @Headers('x-storage-account') account: string | undefined,
    @Res() response: Response,
  ) {
    const owner = await this.owner(id, cookie, token, account);
    if (await this.objects.exists(owner, id)) {
      response.set('Cache-Control', 'no-store').json({ url: await this.objects.download(owner, id) });
      return;
    }
    const [file] = await this.database.db
      .select()
      .from(savedFiles)
      .where(and(eq(savedFiles.owner, owner), eq(savedFiles.id, id)));
    if (!file) throw new NotFoundException();
    // Migrate on first access; retain the database original for recovery.
    await this.objects.write(owner, id, file.data);
    response.set('Cache-Control', 'no-store').json({ url: await this.objects.download(owner, id) });
  }

  @Put(':id')
  async write(
    @Param('id') id: string,
    @Headers('cookie') cookie = '',
    @Headers('x-storage-token') token: string,
    @Headers('x-storage-account') account: string | undefined,
    @Body() data: Buffer,
  ) {
    const owner = await this.owner(id, cookie, token, account);
    if (
      !Buffer.isBuffer(data) ||
      !data.length ||
      data.length > 100 * 1024 * 1024
    )
      throw new BadRequestException('Invalid file (maximum 100 MB)');
    // shortcut: unreferenced files are retained; add garbage collection when a retention policy is defined.
    // Preserve immutable legacy IDs too, before accepting a new upload.
    const [legacy] = await this.database.db.select().from(savedFiles)
      .where(and(eq(savedFiles.owner, owner), eq(savedFiles.id, id)));
    await this.objects.write(owner, id, legacy?.data ?? data);
    return { saved: true };
  }
}
