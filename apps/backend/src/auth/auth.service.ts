import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { DatabaseService } from '../database/database.service.js';

export function accountStorageToken(userId: string, secret: string) {
  return createHmac('sha256', secret).update(`lomra-storage:${userId}`).digest('hex');
}

@Injectable()
export class AuthService {
  readonly auth;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    for (const name of ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
      if (!process.env[name]) throw new Error(`${name} is required`);
    }
    if (process.env.BETTER_AUTH_SECRET!.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
    this.auth = betterAuth({
      database: drizzleAdapter(database.db, { provider: 'pg' }),
      baseURL: process.env.BETTER_AUTH_URL!,
      secret: process.env.BETTER_AUTH_SECRET!,
      trustedOrigins: [process.env.BETTER_AUTH_URL!],
      socialProviders: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      },
      account: { encryptOAuthTokens: true },
    });
  }

  async storageToken(cookie: string, guestToken: string, expectedAccount?: string) {
    const session = await this.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (expectedAccount !== undefined && expectedAccount !== (session?.user.id ?? 'guest')) {
      throw new UnauthorizedException('Account changed. Reload before saving.');
    }
    if (session) return accountStorageToken(session.user.id, process.env.BETTER_AUTH_SECRET!);
    // An expired account must not silently write into the guest's storage.
    if (/(?:^|;\s*)(?:__Secure-)?better-auth\./.test(cookie)) throw new UnauthorizedException('Sign in again to access your data');
    return guestToken;
  }
}
