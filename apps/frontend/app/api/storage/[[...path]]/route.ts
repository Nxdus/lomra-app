import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

async function fileBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100 * 1024 * 1024) {
      await reader.cancel();
      throw new RangeError('File exceeds 100 MB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response(null, { status: 403 });
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ message: 'Invalid origin' }, { status: 403 });
  }
  const jar = await cookies();
  let token = jar.get('lomra-session')?.value;
  const { path = [] } = await context.params;
  if (!path.length && request.method === 'GET') {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) token = randomBytes(32).toString('hex');
    jar.set('lomra-session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
    try {
      const session = await fetch(new URL('/api/auth/get-session', process.env.BACKEND_URL ?? 'http://127.0.0.1:3001'), {
        headers: { cookie: request.headers.get('cookie') ?? '' }, cache: 'no-store', signal: AbortSignal.timeout(30_000),
      });
      if (!session.ok) throw new Error('Session unavailable');
      const account = await session.json();
      if (account?.user.id) {
        const imported = await fetch(new URL('/storage/import-guest', process.env.BACKEND_URL ?? 'http://127.0.0.1:3001'), {
          method: 'POST', headers: { cookie: request.headers.get('cookie') ?? '', 'x-storage-token': token, origin: new URL(request.url).origin },
          cache: 'no-store', signal: AbortSignal.timeout(120_000),
        });
        if (!imported.ok) throw new Error('Could not import guest data');
      }
      return Response.json({ ready: true, account: account?.user.id ?? null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ message: 'Could not check storage account. Reload to retry.' }, { status: 502 });
    }
  }
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return Response.json({ message: 'Session missing. Reload to retry.' }, { status: 401 });
  if (!['chats', 'keys', 'canvas', 'settings', 'files'].includes(path[0]) || path.length > 2) return new Response(null, { status: 404 });
  const file = path[0] === 'files';
  if (file && (path.length !== 2 || !['GET', 'PUT'].includes(request.method))) return new Response(null, { status: 404 });
  try {
    const response = await fetch(new URL(`/storage/${path.map(encodeURIComponent).join('/')}`, process.env.BACKEND_URL ?? 'http://127.0.0.1:3001'), {
      method: request.method,
      headers: { 'Content-Type': file ? 'application/octet-stream' : 'application/json', 'x-storage-token': token, cookie: request.headers.get('cookie') ?? '', ...(request.headers.has('x-storage-account') ? { 'x-storage-account': request.headers.get('x-storage-account')! } : {}) },
      body: request.method === 'PUT' ? file ? await fileBody(request) : await request.text() : undefined,
      cache: 'no-store', signal: AbortSignal.timeout(file ? 120_000 : 30_000),
    });
    if (file && request.method === 'GET' && response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const { url } = await response.json() as { url: string };
      // Keep S3 private: remote development forwards only the app's port.
      const object = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120_000) });
      if (!object.ok) return Response.json({ message: 'Object storage unavailable. Please retry.' }, { status: 502 });
      const bytes = await object.arrayBuffer();
      return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    // Read inside the try: upstream disconnects can happen after headers arrive.
    const body = await response.arrayBuffer();
    return new Response(response.status === 204 ? null : body, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ message: 'File exceeds 100 MB' }, { status: 413 });
    return Response.json({ message: 'Database service unavailable. Please retry.' }, { status: 502 });
  }
}

export { handle as GET, handle as PUT, handle as DELETE };
