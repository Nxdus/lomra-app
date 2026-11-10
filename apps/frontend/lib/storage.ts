let session: Promise<{ account: string | null }> | undefined;

async function readJson(url: string, headers?: HeadersInit) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', headers, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
          throw new Error(`Could not read storage (HTTP ${response.status}).`);
        }
        await response.body?.cancel();
        throw new TypeError(`Storage temporarily unavailable (HTTP ${response.status}).`);
      }
      return await response.json();
    } catch (error) {
      if (attempt >= 2 || !(error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError'))) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
}

export function storageSession() {
  session ??= (readJson('/api/storage') as Promise<{ account: string | null }>).catch((error) => { session = undefined; throw error; });
  return session;
}

export async function canImportBrowserData() {
  const { account } = await storageSession();
  if (!account) return true;
  const owner = localStorage.getItem('lomra-browser-data-owner');
  if (!owner) localStorage.setItem('lomra-browser-data-owner', account);
  return !owner || owner === account;
}

export async function storage(path: string, method = 'GET', value?: unknown) {
  const { account } = await storageSession();
  if (method === 'GET') return readJson(`/api/storage/${path}`, { 'x-storage-account': account ?? 'guest' });
  const response = await fetch(`/api/storage/${path}`, {
    method, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-storage-account': account ?? 'guest' },
    body: value === undefined ? undefined : JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error('Could not access database. Please retry.');
  return response.json();
}

export async function storageFile(id: string, file?: File) {
  const { account } = await storageSession();
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/storage/files/${encodeURIComponent(id)}`, {
        method: file ? 'PUT' : 'GET', cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream', 'x-storage-account': account ?? 'guest' },
        body: file,
      });
      if (!response.ok) {
        if (!file && attempt < 2 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          continue;
        }
        throw new Error(`Could not access canvas file (HTTP ${response.status}).`);
      }
      // Await the body too: a connection can fail after the headers arrived.
      if (file) return undefined;
      if (response.headers.get('content-type')?.includes('application/json')) {
        const { url } = await response.json() as { url: string };
        const object = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(120_000) });
        if (!object.ok) throw new TypeError(`Object storage returned HTTP ${object.status}`);
        return await object.blob();
      }
      return await response.blob();
    } catch (error) {
      if (file || attempt >= 2 || !(error instanceof TypeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
}
