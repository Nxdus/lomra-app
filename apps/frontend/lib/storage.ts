async function readJson(url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120_000) });
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

export async function storage(path: string, method = 'GET', value?: unknown) {
  if (method === 'GET') return readJson(`/api/storage/${path}`);
  const response = await fetch(`/api/storage/${path}`, {
    method, cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error('Could not access database. Please retry.');
  return response.json();
}

const pendingFiles = new Map<string, Promise<Blob | undefined>>();

export async function storageFile(id: string, file?: File) {
  if (file) return transferFile(id, file);
  let pending = pendingFiles.get(id);
  if (!pending) {
    pending = transferFile(id).finally(() => pendingFiles.delete(id));
    pendingFiles.set(id, pending);
  }
  return pending;
}

async function transferFile(id: string, file?: File) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/storage/files/${encodeURIComponent(id)}`, {
        method: file ? 'PUT' : 'GET', cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream' },
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
      return file ? undefined : await response.blob();
    } catch (error) {
      if (file || attempt >= 2 || !(error instanceof TypeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
}
