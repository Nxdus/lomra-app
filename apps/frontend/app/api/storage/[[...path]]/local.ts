import { localStore } from '@/lib/local-store/store';
import { StoreError, kinds, type Kind } from '@/lib/local-store/validation';

const MAX_FILE = 100 * 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function fileBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE) {
      await reader.cancel();
      throw new RangeError('File exceeds 100 MB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Serves `/api/storage` from the workspace folder on disk. */
export async function handleLocal(request: Request, path: string[], root: string) {
  const [kind, id] = path;
  try {
    const store = await localStore(root);
    if (kind === 'files') {
      if (path.length !== 2) return new Response(null, { status: 404 });
      if (request.method === 'GET') {
        return new Response(new Uint8Array(await store.readFile(id)), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
      }
      if (request.method === 'PUT') {
        await store.writeFile(id, await fileBody(request));
        return Response.json({ saved: true }, { headers });
      }
      return new Response(null, { status: 404 });
    }
    if (!kinds.includes(kind as Kind) || path.length > 2) return new Response(null, { status: 404 });
    if (request.method === 'GET' && path.length === 1) return Response.json(await store.list(kind as Kind), { headers });
    if (path.length !== 2) return new Response(null, { status: 404 });
    if (request.method === 'PUT') {
      await store.save(kind as Kind, id, (await request.json() as { value?: unknown }).value);
      return Response.json({ saved: true }, { headers });
    }
    if (request.method === 'DELETE') {
      await store.remove(kind as Kind, id);
      return Response.json({ deleted: true }, { headers });
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ message: error.message }, { status: error.status, headers });
    if (error instanceof RangeError) return Response.json({ message: 'File exceeds 100 MB' }, { status: 413, headers });
    if (error instanceof SyntaxError) return Response.json({ message: 'Invalid JSON' }, { status: 400, headers });
    return Response.json({ message: 'Local storage unavailable. Please retry.' }, { status: 500, headers });
  }
}
