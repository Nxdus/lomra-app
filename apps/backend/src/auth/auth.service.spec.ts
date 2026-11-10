import { AuthService, accountStorageToken } from './auth.service.js';

describe('account storage identity', () => {
  const secret = 'test-secret-with-at-least-thirty-two-characters';

  it('is stable across sessions and isolates users and applications', () => {
    expect(accountStorageToken('user-a', secret)).toMatch(/^[a-f0-9]{64}$/);
    expect(accountStorageToken('user-a', secret)).toBe(accountStorageToken('user-a', secret));
    expect(accountStorageToken('user-a', secret)).not.toBe(accountStorageToken('user-b', secret));
    expect(accountStorageToken('user-a', secret)).not.toBe(accountStorageToken('user-a', 'different-secret'));
  });

  it('uses the verified account instead of the caller-supplied guest identity', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', secret);
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.defineProperty(service, 'auth', { value: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: 'user-a' } }) } } });
    expect(await service.storageToken('better-auth.session_token=valid', 'forged-guest-token')).toBe(accountStorageToken('user-a', secret));
    vi.unstubAllEnvs();
  });

  it('preserves guests but rejects an expired or forged account cookie', async () => {
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.defineProperty(service, 'auth', { value: { api: { getSession: vi.fn().mockResolvedValue(null) } } });
    expect(await service.storageToken('', 'guest-token')).toBe('guest-token');
    await expect(service.storageToken('', 'guest-token', 'old-account')).rejects.toThrow('Account changed');
    await expect(service.storageToken('better-auth.session_token=forged', 'guest-token')).rejects.toThrow('Sign in again');
    await expect(service.storageToken('__Secure-better-auth.session_token=expired', 'guest-token')).rejects.toThrow('Sign in again');
  });
});
