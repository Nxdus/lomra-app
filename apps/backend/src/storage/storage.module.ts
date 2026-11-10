import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StorageController } from './storage.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageFilesController } from './storage-files.controller.js';
import { StorageImportController } from './storage-import.controller.js';
import { ObjectStorageService } from './object-storage.service.js';

@Module({ imports: [DatabaseModule, AuthModule], providers: [ObjectStorageService], controllers: [StorageImportController, StorageFilesController, StorageController] })
export class StorageModule {}
