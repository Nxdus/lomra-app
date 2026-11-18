import { homedir } from 'node:os';
import { join } from 'node:path';
import { handleLocal } from './local';

/** Workspace folder; the desktop app sets LOMRA_DATA_DIR. */
const dataDir = () => process.env.LOMRA_DATA_DIR ?? join(homedir(), 'Documents', 'Lomra');

async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response(null, { status: 403 });
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ message: 'Invalid origin' }, { status: 403 });
  }
  const { path = [] } = await context.params;
  return handleLocal(request, path, dataDir());
}

export { handle as GET, handle as PUT, handle as DELETE };
