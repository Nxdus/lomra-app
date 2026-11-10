import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthService } from './auth.service.js';

@Module({ imports: [DatabaseModule], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
