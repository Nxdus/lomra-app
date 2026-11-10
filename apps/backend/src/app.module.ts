import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { TranscriptionModule } from './transcription/transcription.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, TranscriptionModule, StorageModule],
})
export class AppModule {}
