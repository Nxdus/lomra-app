import { dataDir } from '@/lib/local-store/data-dir';
import { handleLocal } from './local';

async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response(null, { status: 403 });
  // Compare with the Host header: Next may report the request URL as localhost while the app is served from 127.0.0.1.
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && (!origin || new URL(origin).host !== request.headers.get('host'))) {
    return Response.json({ message: 'Invalid origin' }, { status: 403 });
  }
  const { path = [] } = await context.params;
  return handleLocal(request, path, dataDir());
}

export { handle as GET, handle as PUT, handle as DELETE };
