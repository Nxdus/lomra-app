import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, POST } from './route';

test('OAuth proxy preserves redirects, state cookies and origin without forwarding untrusted headers', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded: RequestInit | undefined;
  let destination = '';
  try {
    globalThis.fetch = (async (url, options) => {
      destination = String(url);
      forwarded = options;
      const headers = new Headers({ location: 'http://localhost:3000/' });
      headers.append('set-cookie', 'better-auth.session_token=test; HttpOnly; Path=/; SameSite=Lax');
      headers.append('set-cookie', 'better-auth.state=; Max-Age=0; Path=/');
      return new Response(null, { status: 302, headers });
    }) as typeof fetch;
    const response = await GET(new Request('http://localhost:3000/api/auth/callback/google?code=test&state=test', {
      headers: { cookie: 'better-auth.state=test', 'x-forwarded-host': 'attacker.example' },
    }));
    assert.equal(destination, new URL('/api/auth/callback/google?code=test&state=test', process.env.BACKEND_URL ?? 'http://127.0.0.1:3001').href);
    assert.equal(forwarded?.redirect, 'manual');
    assert.equal(new Headers(forwarded?.headers).get('cookie'), 'better-auth.state=test');
    assert.equal(new Headers(forwarded?.headers).has('x-forwarded-host'), false);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:3000/');
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const blocked = await POST(new Request('http://localhost:3000/api/auth/sign-in/social', {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{"provider":"google"}',
    }));
    assert.equal(blocked.status, 403);
    assert.equal((await POST(new Request('http://localhost:3000/api/auth/sign-out', { method: 'POST' }))).status, 403);
    await POST(new Request('http://localhost:3000/api/auth/sign-in/social', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: '{"provider":"google"}',
    }));
    assert.equal(new Headers(forwarded?.headers).get('origin'), 'http://localhost:3000');
    assert.equal(forwarded?.body, '{"provider":"google"}');

    globalThis.fetch = (async () => { throw new Error('private backend error'); }) as typeof fetch;
    const failure = await GET(new Request('http://localhost:3000/api/auth/get-session'));
    assert.equal(failure.status, 502);
    assert.doesNotMatch(await failure.text(), /private backend error/);
  } finally { globalThis.fetch = originalFetch; }
});
