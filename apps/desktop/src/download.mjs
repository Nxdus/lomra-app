import { createHash } from 'node:crypto';
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Where an unfinished download is kept. The name carries the expected hash, so another file is never appended to it. */
export const partFile = (file, sha256) => `${file}.${sha256.slice(0, 16)}.part`;

/** How much of `file` an unfinished download holds. */
export function partBytes(file, sha256) {
  try { return statSync(partFile(file, sha256)).size; } catch { return 0; }
}

/** Every unfinished download of `file`, whichever hash it was for (and the unbound `.part` older versions left). */
export function listParts(file) {
  const prefix = `${basename(file)}.`;
  try {
    return readdirSync(dirname(file)).filter((name) => name.startsWith(prefix) && /^(?:[a-f0-9]{16}\.)?part$/.test(name.slice(prefix.length))).map((name) => join(dirname(file), name));
  } catch { return []; }
}

export function removeParts(file, keep) {
  for (const part of listParts(file)) if (part !== keep) rmSync(part, { force: true });
}

/** A failure worth trying again: the connection, or a server that is busy. */
class TransientError extends Error {}
const lost = () => new TransientError('The connection was lost. Try again to continue where it stopped.');
/** Progress after which earlier connection failures no longer count, so a long download survives many short drops. */
const recoveredBytes = 8 * 1024 * 1024;

/**
 * Downloads `url` to `file`, checking its SHA-256. Nothing is placed at `file` unless the whole file matches. An
 * unfinished download (connection lost, aborted, app quit) stays next to it and the next call continues it.
 * `onBytes` receives the bytes gained, including the ones already on disk; it is negative when the download starts over.
 */
export async function downloadFile(fetchImpl, url, file, { sha256, signal, onBytes, idleTimeout = 60_000, retryDelays = [1_000, 3_000, 8_000, 20_000] }) {
  const part = partFile(file, sha256);
  removeParts(file, part);
  const handle = await open(part, existsSync(part) ? 'r+' : 'w+');
  // `hash` and `size` always describe exactly what is on disk, so a retry can continue without reading the file again.
  let hash = createHash('sha256');
  let size = 0;
  const count = (chunk) => { hash.update(chunk); size += chunk.length; onBytes?.(chunk.length); };
  const startOver = async () => {
    await handle.truncate(0);
    onBytes?.(-size);
    hash = createHash('sha256');
    size = 0;
  };

  /** One request. True once the body is complete, false to ask again right away (the part had to be discarded). */
  async function request() {
    const idle = new AbortController();
    const timer = setTimeout(() => idle.abort(), idleTimeout);
    try {
      let response;
      // Compression would make byte ranges count something else than the bytes on disk.
      const headers = { 'accept-encoding': 'identity', ...(size ? { range: `bytes=${size}-` } : {}) };
      try { response = await fetchImpl(url, { headers, signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal }); } catch { throw lost(); }
      const { status } = response;
      if (status === 416 && size) { await startOver(); return false; }
      if (status === 401 || status === 403) throw new Error('This download needs a login, which Lomra does not support.');
      if (status === 408 || status === 425 || status === 429 || status >= 500) throw new TransientError(`The download failed (${status}).`);
      if (!response.ok || !response.body || (status === 206 && !size)) throw new Error(`The download failed (${status}).`);
      let expected = NaN;
      if (status === 206) {
        const [, start, end, total] = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '') ?? [];
        if (Number(start) !== size || (total !== '*' && Number(end) !== Number(total) - 1)) { await startOver(); return false; }
        expected = Number(end) + 1;
      } else {
        // The server ignored the range and sends the whole file.
        if (size) await startOver();
        if (!response.headers.get('content-encoding')) expected = Number(response.headers.get('content-length') ?? NaN);
      }
      const reader = response.body.getReader();
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); } catch { throw lost(); }
        if (chunk.done) break;
        timer.refresh();
        for (let offset = 0; offset < chunk.value.length;) offset += (await handle.write(chunk.value, offset, chunk.value.length - offset, size + offset)).bytesWritten;
        count(chunk.value);
      }
      if (size < expected) throw lost();
      return true;
    } finally {
      clearTimeout(timer);
      idle.abort(); // Frees the connection when the body was not read to its end.
    }
  }

  let matches = false;
  let finished = false;
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      count(buffer.subarray(0, bytesRead));
    }
    // A part that is already complete needs no request.
    finished = size > 0 && hash.copy().digest('hex') === sha256;
    for (let failures = 0; !finished;) {
      const before = size;
      try {
        finished = await request();
      } catch (cause) {
        signal?.throwIfAborted();
        if (!(cause instanceof TransientError)) throw cause;
        if (size - before >= recoveredBytes) failures = 0;
        if (failures >= retryDelays.length) throw cause;
        await sleep(retryDelays[failures++], undefined, { signal });
      }
    }
    matches = hash.digest('hex') === sha256;
  } finally {
    await handle.close();
    if (finished ? !matches : !size) rmSync(part, { force: true });
  }
  if (!matches) throw new Error('The download was corrupted. Try again.');
  renameSync(part, file);
}

/** Unpacks a zip with the system's tar (Windows, macOS) or unzip (Linux). */
export function extractZip(zip, dest, { platform, env, spawnProcess }, what = 'a download') {
  const [command, args] = platform === 'linux' ? ['unzip', ['-q', '-o', zip, '-d', dest]]
    : [platform === 'win32' ? join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', dest]];
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(command, args, { windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => reject(new Error(`Could not unpack ${what}.`)));
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not unpack ${what}.`)));
  });
}

/** Enough for every built-in model plus a pile of added ones; keeps the renderer from filling memory. */
const maxWaiting = 20;

/**
 * Runs model downloads one after another. `run(item)` does the work and may put its progress on the item;
 * `explain(cause)` words a failure. A failed item does not stop the ones behind it.
 */
export function createDownloadQueue(run, explain) {
  let running = null;
  const waiting = [];
  const errors = new Map();
  function next() {
    running = waiting.shift() ?? null;
    if (!running) return;
    const item = running;
    item.done = run(item)
      .catch((cause) => { if (!item.controller.signal.aborted) errors.set(item.id, `${item.name}: ${explain(cause)}`); })
      .finally(next);
  }
  return {
    /** The item being downloaded, or null. */
    get running() { return running; },
    get waiting() { return waiting.map(({ id, name }) => ({ id, name })); },
    get idle() { return !running && !waiting.length; },
    /** What went wrong since the queue was last empty, one line per model; null when nothing did. */
    get error() { return errors.size ? [...errors.values()].join('\n') : null; },
    has: (id) => running?.id === id || waiting.some((item) => item.id === id),
    /** Adds `{ id, name, … }`. False when that model is already there (unless it is just being stopped) or the queue is full. */
    add(item) {
      if ((running?.id === item.id && !running.controller.signal.aborted) || waiting.some(({ id }) => id === item.id) || waiting.length >= maxWaiting) return false;
      if (!running) errors.clear();
      errors.delete(item.id);
      waiting.push({ ...item, controller: new AbortController() });
      if (!running) next();
      return true;
    },
    /** Drops the error of a model that is gone. */
    forget(id) { errors.delete(id); },
    /** Stops one model, or the running one when no id is given. Resolves once its file is closed. */
    async cancel(id) {
      const index = waiting.findIndex((item) => item.id === id);
      if (index >= 0) waiting.splice(index, 1);
      if (running && (id === undefined || running.id === id)) {
        running.controller.abort();
        await running.done;
      }
    },
    stop() {
      waiting.length = 0;
      running?.controller.abort();
    },
  };
}
