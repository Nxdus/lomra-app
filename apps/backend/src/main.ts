import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AuthService } from './auth/auth.service.js';
import type { Express } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const auth = app.get(AuthService);
  const server: Express = app.getHttpAdapter().getInstance();
  server.all('/api/auth/*splat', toNodeHandler(auth.auth));
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '100mb' });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
