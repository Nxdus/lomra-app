// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { test, expect, mock } from 'bun:test';

mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) }));
const { GET } = await import('./route');

test('remote clients receive S3 bytes through the app port without exposing signed URLs', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (url, options) => {
      calls.push(String(url));
      if (String(url).includes('/storage/files/')) {
        expect(new Headers(options?.headers).get('cookie')).toBe('session=test');
        return Response.json({ url: 'http://localhost:8333/private/file?signature=test' });
      }
      expect(options?.headers).toBeUndefined();
      return new Response(new Uint8Array([0, 128, 255]));
    }) as typeof fetch;
    const response = await GET(new Request('http://localhost:3000/api/storage/files/asset', {
      headers: { cookie: 'session=test', 'x-storage-account': 'account' },
    }), { params: Promise.resolve({ path: ['files', 'asset'] }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
    expect(calls).toHaveLength(2);
  } finally { globalThis.fetch = originalFetch; }
});

test('an upstream body disconnect becomes a retryable HTTP error', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('Disconnected')); } }))) as typeof fetch;
    const response = await GET(new Request('http://localhost:3000/api/storage/chats'), { params: Promise.resolve({ path: ['chats'] }) });
    expect(response.status).toBe(502);
  } finally { globalThis.fetch = originalFetch; }
});
