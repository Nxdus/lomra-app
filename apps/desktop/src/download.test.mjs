import { afterEach, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDownloadQueue, downloadFile, listParts, partBytes, partFile } from './download.mjs';
import { createFfmpeg } from './ffmpeg.mjs';
import { createLocal3d } from './local3d.mjs';
import { createSd } from './sd.mjs';
import { customModelId } from './sd-models.mjs';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (until) => { for (let i = 0; i < 600; i++) { if (await until()) return; await pause(5); } throw new Error('Timed out waiting.'); };
const body = randomBytes(300_000);
const half = 150_000;

const cleanup = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-download-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Where a request asks to start, or NaN without a Range header. */
const rangeStart = (request) => Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? '')?.[1] ?? NaN);

/** Answers with `data`, or the part of it the Range header asks for, like Hugging Face does. */
function sendRange(request, response, data) {
  const start = rangeStart(request);
  if (Number.isNaN(start)) response.writeHead(200, { 'content-length': data.length }).end(data);
  else if (start >= data.length) response.writeHead(416, { 'content-range': `bytes */${data.length}` }).end();
  else response.writeHead(206, { 'content-length': data.length - start, 'content-range': `bytes ${start}-${data.length - 1}/${data.length}` }).end(data.subarray(start));
}

/** Promises the whole rest of `data` but sends it only up to `until`, then drops the connection or leaves it hanging. */
function sendCut(request, response, data, until, hang = false) {
  const start = rangeStart(request) || 0;
  response.writeHead(start ? 206 : 200, { 'content-length': data.length - start, ...(start ? { 'content-range': `bytes ${start}-${data.length - 1}/${data.length}` } : {}) });
  response.write(data.subarray(start, until), () => { if (!hang) setTimeout(() => response.socket.destroy(), 50); });
}

/** A real HTTP server. `handle` answers a request, or returns false to have `bodies[path]` served. */
async function serve(bodies, handle = () => false) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, range: request.headers.range });
    if (handle(request, response, requests.length) !== false) return;
    if (bodies[request.url]) sendRange(request, response, bodies[request.url]);
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => { server.closeAllConnections(); server.close(); });
  return { requests, url: `http://127.0.0.1:${server.address().port}` };
}

/** One download of `/model` into a temp folder, with the progress it reported. */
async function setUp(handle) {
  const server = await serve({ '/model': body }, handle);
  const file = join(tempDir(), 'model.safetensors');
  const progress = { now: 0, max: 0, min: 0 };
  const onBytes = (n) => { progress.now += n; progress.max = Math.max(progress.max, progress.now); progress.min = Math.min(progress.min, progress.now); };
  return {
    ...server, file, progress, part: partFile(file, sha(body)),
    run: (extra) => { progress.now = 0; return downloadFile(fetch, `${server.url}/model`, file, { sha256: sha(body), retryDelays: [1, 1], idleTimeout: 5_000, onBytes, ...extra }); },
  };
}
function expectDone({ file, progress, part }) {
  expect(sha(readFileSync(file))).toBe(sha(body));
  expect(existsSync(part)).toBe(false);
  expect(progress).toEqual({ now: body.length, max: body.length, min: 0 });
}

test('a connection dropped in the middle continues with a Range request', async () => {
  const download = await setUp((request, response, nth) => nth === 1 ? sendCut(request, response, body, half) : false);
  await download.run();
  expect(download.requests.map((item) => item.range)).toEqual([undefined, `bytes=${half}-`]);
  expectDone(download);
});

test('a connection that keeps dropping gives up, keeps the part, and the next call continues it', async () => {
  let broken = true;
  const download = await setUp((request, response) => broken ? sendCut(request, response, body, half) : false);
  await expect(download.run()).rejects.toThrow('The connection was lost.');
  expect(download.requests).toHaveLength(3);
  expect(existsSync(download.file)).toBe(false);
  expect(partBytes(download.file, sha(body))).toBe(half);
  broken = false;
  await download.run();
  expect(download.requests.at(-1).range).toBe(`bytes=${half}-`);
  expectDone(download);
});

test('a server that ignores Range starts the file over', async () => {
  const download = await setUp((_request, response) => { response.writeHead(200, { 'content-length': body.length }).end(body); });
  writeFileSync(download.part, body.subarray(0, half));
  await download.run();
  expect(download.requests).toEqual([{ path: '/model', range: `bytes=${half}-` }]);
  expectDone(download);
});

test.each([
  ['another start', `bytes 0-${body.length - 1}/${body.length}`],
  ['a range that ends early', `bytes ${half}-${body.length - 10}/${body.length}`],
  ['no Content-Range', undefined],
  ['a malformed Content-Range', 'bytes nonsense'],
])('a 206 with %s is not appended', async (_name, contentRange) => {
  const download = await setUp((request, response) => {
    if (!request.headers.range) return false;
    response.writeHead(206, contentRange ? { 'content-range': contentRange } : {}).end(body.subarray(half));
  });
  writeFileSync(download.part, body.subarray(0, half));
  await download.run();
  expect(download.requests.map((item) => item.range)).toEqual([`bytes=${half}-`, undefined]);
  expectDone(download);
});

test('a complete part is checked and used without asking the server', async () => {
  const download = await setUp();
  writeFileSync(download.part, body);
  await download.run();
  expect(download.requests).toEqual([]);
  expectDone(download);
});

test('a 416 for a part that is too long and wrong starts over', async () => {
  const download = await setUp();
  writeFileSync(download.part, randomBytes(body.length + 5));
  await download.run();
  expect(download.requests.map((item) => item.range)).toEqual([`bytes=${body.length + 5}-`, undefined]);
  expect(sha(readFileSync(download.file))).toBe(sha(body));
  expect(download.progress.now).toBe(body.length);
});

test('a corrupted part is found by the hash, deleted and reported; the next call starts clean', async () => {
  const download = await setUp();
  writeFileSync(download.part, randomBytes(half));
  await expect(download.run()).rejects.toThrow('The download was corrupted.');
  expect(readdirSync(join(download.file, '..'))).toEqual([]);
  await download.run();
  expect(download.requests.at(-1).range).toBeUndefined();
  expectDone(download);
});

test('a part of a file with another hash, or from an older version, is never continued', async () => {
  const download = await setUp();
  writeFileSync(partFile(download.file, sha('other')), body.subarray(0, half));
  writeFileSync(`${download.file}.part`, body.subarray(0, half));
  // A different file with a similar name keeps its part.
  const other = partFile(`${download.file}2`, sha('other'));
  writeFileSync(other, 'x');
  await download.run();
  expect(download.requests[0].range).toBeUndefined();
  expect(listParts(download.file)).toEqual([]);
  expect(existsSync(other)).toBe(true);
  expectDone(download);
});

test('an abort keeps the part and the next call continues it', async () => {
  const download = await setUp((request, response, nth) => nth === 1 ? sendCut(request, response, body, half, true) : false);
  const controller = new AbortController();
  const stopped = download.run({ signal: controller.signal }).catch((cause) => cause);
  await wait(() => download.progress.now === half);
  controller.abort();
  expect((await stopped).name).toBe('AbortError');
  expect(download.requests).toHaveLength(1);
  expect(readFileSync(download.part).equals(body.subarray(0, half))).toBe(true);
  await download.run();
  expect(download.requests[1].range).toBe(`bytes=${half}-`);
  expectDone(download);
});

test('an abort while waiting to retry stops at once', async () => {
  const download = await setUp((request, response) => sendCut(request, response, body, half));
  const controller = new AbortController();
  const stopped = download.run({ signal: controller.signal, retryDelays: [60_000] }).catch((cause) => cause);
  await wait(() => download.progress.now === half);
  await pause(150);
  controller.abort();
  expect((await stopped).name).toBe('AbortError');
  expect(partBytes(download.file, sha(body))).toBe(half);
});

test('a connection that hangs in the body is dropped after the idle timeout and continued', async () => {
  const download = await setUp((request, response, nth) => nth === 1 ? sendCut(request, response, body, half, true) : false);
  await download.run({ idleTimeout: 150 });
  expect(download.requests[1].range).toBe(`bytes=${half}-`);
  expectDone(download);
});

test('a server that never answers fails in the end and leaves nothing behind', async () => {
  const download = await setUp(() => {});
  await expect(download.run({ idleTimeout: 50 })).rejects.toThrow('The connection was lost.');
  expect(download.requests).toHaveLength(3);
  expect(readdirSync(join(download.file, '..'))).toEqual([]);
});

test.each([401, 403, 404])('%i is not retried and keeps the part', async (status) => {
  const download = await setUp((_request, response) => { response.writeHead(status).end(); });
  writeFileSync(download.part, body.subarray(0, half));
  await expect(download.run()).rejects.toThrow(status === 404 ? 'The download failed (404).' : 'needs a login');
  expect(download.requests).toHaveLength(1);
  expect(statSync(download.part).size).toBe(half);
});

test('a busy server is retried', async () => {
  const download = await setUp((_request, response, nth) => nth === 1 ? void response.writeHead(503).end() : false);
  await download.run();
  expect(download.requests).toHaveLength(2);
  expectDone(download);
});

test('a full disk is not retried', async () => {
  const download = await setUp();
  const full = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  // The progress callback runs where the write happens, so it stands in for a disk that is full.
  await expect(download.run({ onBytes: () => { throw full; } })).rejects.toThrow('ENOSPC');
  expect(download.requests).toHaveLength(1);
});

test('the queue runs in order, ignores duplicates, skips a canceled item and goes on after a failure', async () => {
  const started = [];
  const gates = {};
  const queue = createDownloadQueue(async (item) => {
    started.push(item.id);
    await new Promise((resolve, reject) => { gates[item.id] = { resolve, reject }; item.controller.signal.addEventListener('abort', () => reject(item.controller.signal.reason)); });
  }, (cause) => cause.message);
  const add = (id) => queue.add({ id, name: id.toUpperCase() });
  expect(['a', 'b', 'c', 'd', 'a', 'c'].map(add)).toEqual([true, true, true, true, false, false]);
  expect(started).toEqual(['a']);
  expect(queue.waiting).toEqual([{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }]);
  await queue.cancel('c');
  gates.a.reject(new Error('The disk broke.'));
  await wait(() => started.length === 2);
  expect(queue.error).toBe('A: The disk broke.');
  expect(queue.running.id).toBe('b');
  await queue.cancel('b');
  await wait(() => started.length === 3);
  expect(started).toEqual(['a', 'b', 'd']);
  gates.d.resolve();
  await wait(() => queue.idle);
  expect(queue.error).toBe('A: The disk broke.');
  expect(add('a')).toBe(true);
  expect(queue.error).toBeNull();
  // Stop and resume in one go: the model waits until its own stop has finished.
  const stopping = queue.cancel('a');
  expect(add('a')).toBe(true);
  await stopping;
  await wait(() => started.length === 5);
  expect(queue.running.id).toBe('a');
  // Stopping everything leaves nothing to start.
  add('b');
  queue.stop();
  await wait(() => queue.idle);
  expect(started).toEqual(['a', 'b', 'd', 'a', 'a']);
  for (let i = 0; i < 30; i++) add(`many-${i}`);
  expect(queue.waiting).toHaveLength(20);
  queue.stop();
});

// ---- Image models ----

const engineZip = Buffer.from('engine-zip');
const weights = { one: randomBytes(300_000), two: randomBytes(200_000), custom: randomBytes(250_000) };
const sdModel = (id, extra) => ({ id, name: id.toUpperCase(), quality: '', note: '', repo: 'a/b', file: `${id}.safetensors`, sha256: sha(weights[id]), bytes: weights[id].length, size: 512, steps: 4, cfg: 1, ...extra });
const sdBodies = { '/engine.zip': engineZip, '/one.safetensors': weights.one, '/two.safetensors': weights.two, '/my.safetensors': weights.custom };
const customRequest = { repo: 'a/b', file: 'my.safetensors', family: 'sdxl' };
const customId = customModelId('a/b', 'my.safetensors');
const tree = JSON.stringify([{ type: 'file', path: 'my.safetensors', size: weights.custom.length, lfs: { oid: sha(weights.custom) } }]);

/** Image models downloaded from a real local server; only the host is swapped. */
function makeSd(url, dir = tempDir(), overrides = {}) {
  const fetchImpl = (target, init) => fetch(`${url}/${String(target).includes('/tree/') ? 'tree' : String(target).split('/').pop()}`, init);
  return createSd({
    dir, platform: 'win32', arch: 'x64', env: {}, fetchImpl, extract: async (_zip, dest) => writeFileSync(join(dest, 'sd-cli.exe'), 'binary'),
    models: [sdModel('one', { default: true }), sdModel('two')], engines: { 'win32-x64': { asset: 'engine.zip', sha256: sha(engineZip), bytes: engineZip.length } }, ...overrides,
  });
}
const serveSd = (handle = () => false) => serve(sdBodies, (request, response, nth) => request.url === '/tree' ? void response.writeHead(200).end(tree) : handle(request, response, nth));
const row = (sd, id) => sd.status().models.find((model) => model.id === id);

test('image models: waiting models are listed, one can be canceled, and the rest install in order', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const server = await serveSd((request, response) => {
    if (request.url !== '/one.safetensors') return false;
    void gate.then(() => sendRange(request, response, weights.one));
  });
  const sd = makeSd(server.url);
  expect([sd.download('one'), sd.download('two'), sd.download(customRequest), sd.download('two'), sd.download(customRequest)]).toEqual([true, true, true, false, false]);
  await wait(() => sd.status().downloading?.stage === 'model');
  expect(sd.status()).toMatchObject({ downloading: { id: 'one', received: 0, total: weights.one.length }, queued: [{ id: 'two', name: 'TWO' }, { id: customId, name: 'my' }] });
  expect(sd.remove('one')).toBe(false);
  expect(sd.remove('two')).toBe(false);
  await sd.cancelDownload('two');
  expect(sd.status().queued).toEqual([{ id: customId, name: 'my' }]);
  release();
  await wait(() => !sd.status().downloading);
  expect(sd.status()).toMatchObject({ error: null, queued: [] });
  expect(sd.status().models.map((model) => [model.id, model.installed])).toEqual([['one', true], ['two', false], [customId, true]]);
  expect(server.requests.some((item) => item.path === '/two.safetensors')).toBe(false);
});

test('image models: a failure names the model and the next one still installs', async () => {
  const server = await serveSd((request, response) => request.url === '/one.safetensors' ? void response.writeHead(404).end() : false);
  const sd = makeSd(server.url);
  sd.download('one');
  sd.download('two');
  await wait(() => !sd.status().downloading);
  expect(sd.status().error).toBe('ONE: The download failed (404).');
  expect([row(sd, 'one').installed, row(sd, 'two').installed]).toEqual([false, true]);
});

test('image models: Stop keeps the part and a new app instance resumes it', async () => {
  let hang = true;
  const server = await serveSd((request, response) => hang && request.url === '/one.safetensors' ? sendCut(request, response, weights.one, half, true) : false);
  const dir = tempDir();
  const first = makeSd(server.url, dir);
  first.download('one');
  await wait(() => first.status().downloading?.received === half);
  await first.cancelDownload();
  expect(first.status()).toMatchObject({ downloading: null, error: null });
  expect(row(first, 'one')).toMatchObject({ installed: false, partial: half });

  hang = false;
  const second = makeSd(server.url, dir);
  expect(row(second, 'one')).toMatchObject({ installed: false, partial: half });
  second.download('one');
  await wait(() => !second.status().downloading);
  expect(server.requests.at(-1)).toEqual({ path: '/one.safetensors', range: `bytes=${half}-` });
  expect(row(second, 'one')).toMatchObject({ installed: true, partial: 0 });
});

test('image models: quitting in the middle leaves the part for the next start and starts nothing else', async () => {
  const server = await serveSd((request, response) => request.url === '/one.safetensors' ? sendCut(request, response, weights.one, half, true) : false);
  const dir = tempDir();
  const sd = makeSd(server.url, dir);
  sd.download('one');
  sd.download('two');
  await wait(() => sd.status().downloading?.received === half);
  sd.stop();
  await wait(() => !sd.status().downloading);
  expect(sd.status()).toMatchObject({ queued: [], error: null });
  expect(server.requests.some((item) => item.path === '/two.safetensors')).toBe(false);
  expect(row(makeSd(server.url, dir), 'one').partial).toBe(half);
});

test('image models: a Hugging Face model is offered again after a restart, resumes, and its record is validated', async () => {
  let hang = true;
  const server = await serveSd((request, response) => hang && request.url === '/my.safetensors' ? sendCut(request, response, weights.custom, half, true) : false);
  const dir = tempDir();
  const first = makeSd(server.url, dir);
  first.download(customRequest);
  await wait(() => first.status().downloading?.received === half);
  first.stop();
  await wait(() => !first.status().downloading);

  hang = false;
  const custom = join(dir, 'custom');
  const record = JSON.parse(readFileSync(join(custom, `${customId}.json`), 'utf8'));
  const bad = [{ ...record, id: 'hf-else' }, { ...record, repo: '../../x' }, { ...record, file: 'w.ckpt' }, { ...record, repo: ['a/b'] }, { ...record, family: 'nope' }, { ...record, sha256: 'x' }, null];
  bad.forEach((item, index) => writeFileSync(join(custom, `x${index}.json`), JSON.stringify(item)));
  const second = makeSd(server.url, dir);
  expect(second.status().models.filter((model) => model.custom)).toEqual([expect.objectContaining({ id: customId, name: 'my', installed: false, partial: half, bytes: weights.custom.length })]);
  expect(second.download(customId)).toBe(true);
  await wait(() => !second.status().downloading);
  expect(second.status().error).toBeNull();
  expect(server.requests.at(-1)).toEqual({ path: '/my.safetensors', range: `bytes=${half}-` });
  expect(row(second, customId)).toMatchObject({ installed: true, partial: 0, quality: 'SDXL' });
});

test('image models: a failed lookup keeps an unfinished Hugging Face download, and deleting it removes everything', async () => {
  let offline = false;
  const server = await serve(sdBodies, (request, response) => {
    if (request.url === '/tree') return void (offline ? response.writeHead(500).end() : response.writeHead(200).end(tree));
    return request.url === '/my.safetensors' ? sendCut(request, response, weights.custom, half, true) : false;
  });
  const dir = tempDir();
  const sd = makeSd(server.url, dir);
  sd.download(customRequest);
  await wait(() => sd.status().downloading?.received === half);
  expect(sd.remove(customId)).toBe(false);
  await sd.cancelDownload(customId);
  offline = true;
  sd.download(customRequest);
  await wait(() => !sd.status().downloading);
  expect(sd.status().error).toBe('my: Could not reach Hugging Face.');
  expect(row(sd, customId).partial).toBe(half);
  expect(sd.remove(customId)).toBe(true);
  expect(sd.status()).toMatchObject({ engine: false, error: null });
  expect(readdirSync(join(dir, 'custom'))).toEqual([]);
  expect(existsSync(join(dir, 'engine'))).toBe(false);
});

test('image models: the engine stays while another model is downloading, unfinished or making an image', async () => {
  const server = await serveSd((request, response) => request.url === '/two.safetensors' ? sendCut(request, response, weights.two, 50_000, true) : false);
  let finish;
  const spawnProcess = (_command, args) => {
    const handlers = {};
    finish = () => { writeFileSync(args[args.indexOf('-o') + 1], 'png'); handlers.exit(0); };
    return { on: (name, callback) => { handlers[name] = callback; }, kill() {} };
  };
  const sd = makeSd(server.url, undefined, { spawnProcess });
  sd.download('one');
  await wait(() => !sd.status().downloading);
  const image = sd.generate('11111111-1111-1111-1111-111111111111', { model: 'one', prompt: 'a cat' });
  await wait(() => finish);
  expect(sd.remove('one')).toBe(false);
  finish();
  await image;
  sd.download('two');
  await wait(() => sd.status().downloading?.received === 50_000);
  // Safe while another model downloads, but the engine is still needed.
  expect(sd.remove('one')).toBe(true);
  expect(sd.status().engine).toBe(true);
  await sd.cancelDownload();
  expect(sd.status().engine).toBe(true);
  expect(sd.remove('two')).toBe(true);
  expect(sd.status().engine).toBe(false);
});

// ---- 3D models ----

const parts3d = { 'uv.zip': Buffer.from('uv-zip'), 'source.zip': Buffer.from('source-zip'), 'u2net.onnx': Buffer.from('u2net'), 'big-a.bin': randomBytes(200_000), 'big-b.bin': randomBytes(300_000), 'small.bin': randomBytes(1000), 'code.zip': randomBytes(300_000) };
const bodies3d = Object.fromEntries(Object.entries(parts3d).map(([name, data]) => [`/${name}`, data]));
const half3d = 200_000 + half;
function make3d(url, dir = join(tempDir(), '3d'), withSource = false) {
  const file = (path, name) => ({ path, url: `${url}/${name}`, sha256: sha(parts3d[name]), bytes: parts3d[name].length });
  const spawnProcess = (_command, args) => {
    const handlers = {};
    queueMicrotask(() => {
      if (args[0] === 'venv') { mkdirSync(join(args[3], 'Scripts'), { recursive: true }); writeFileSync(join(args[3], 'Scripts', 'python.exe'), 'py'); }
      handlers.exit(0);
    });
    return { on: (name, callback) => { handlers[name] = callback; }, kill() {} };
  };
  return createLocal3d({
    dir, platform: 'win32', arch: 'x64', env: {}, spawnProcess, gpuMemory: async () => 8192, extract: async (_zip, dest) => writeFileSync(join(dest, 'uv.exe'), 'uv'),
    uv: { 'win32-x64': { asset: 'uv.zip', ...file('', 'uv.zip') } }, source: file('', 'source.zip'), downloads: [file('u2net/u2net.onnx', 'u2net.onnx')],
    models: [
      { id: 'big', name: 'Big', kind: 'hunyuan', folder: 'big', needs: 6000, weights: [file('big/a.bin', 'big-a.bin'), file('big/b.bin', 'big-b.bin')] },
      { id: 'small', name: 'Small', kind: 'hunyuan', folder: 'small', needs: 6000, weights: [file('small/w.bin', 'small.bin')], ...(withSource ? { source: file('sources/small', 'code.zip') } : {}) },
    ],
  });
}
const wait3d = (local3d, until) => wait(async () => until(await local3d.status()));
const hang3d = (request, response) => request.url === '/big-b.bin' ? sendCut(request, response, parts3d['big-b.bin'], half, true) : false;

test('3D models: a waiting model installs after the running one fails, and the failure names it', async () => {
  const server = await serve(bodies3d, (request, response) => request.url === '/big-b.bin' ? void response.writeHead(404).end() : false);
  const local3d = make3d(server.url);
  expect(await Promise.all([local3d.install('big'), local3d.install('small'), local3d.install('small')])).toEqual([true, true, false]);
  expect((await local3d.status()).queued).toEqual([{ id: 'small', name: 'Small' }]);
  expect(local3d.remove('small')).toBe(false);
  await wait3d(local3d, (status) => !status.installing);
  const status = await local3d.status();
  expect(status.error).toBe('Big: The download failed (404).');
  expect(status.models.map((model) => [model.installed, model.partial])).toEqual([[false, 200_000], [true, 0]]);
});

test('3D models: Stop keeps every finished and unfinished file, and a restart resumes with the right progress', async () => {
  let hang = true;
  const server = await serve(bodies3d, (request, response) => hang ? hang3d(request, response) : false);
  const dir = join(tempDir(), '3d');
  const first = make3d(server.url, dir);
  await first.install('big');
  await first.install('small');
  await wait3d(first, (status) => status.installing?.received === half3d);
  await first.cancelInstall('small');
  expect((await first.status()).queued).toEqual([]);
  await first.cancelInstall('big');
  expect(await first.status()).toMatchObject({ installing: null, error: null });
  expect((await first.status()).models.map((model) => [model.installed, model.partial])).toEqual([[false, half3d], [false, 0]]);

  const second = make3d(server.url, dir);
  expect((await second.status()).models[0].partial).toBe(half3d);
  await second.install('big');
  await wait3d(second, (status) => status.installing?.received === half3d);
  expect((await second.status()).installing.total).toBe(500_000);
  await second.cancelInstall();
  hang = false;
  const asked = server.requests.length;
  await second.install('big');
  await wait3d(second, (status) => !status.installing);
  expect(server.requests.slice(asked)).toEqual([{ path: '/big-b.bin', range: `bytes=${half}-` }]);
  expect((await second.status()).models[0]).toMatchObject({ installed: true, partial: 0 });
});

test('3D models: deleting an unfinished download removes it, and the engine only with the last one', async () => {
  const server = await serve(bodies3d, hang3d);
  const dir = join(tempDir(), '3d');
  const local3d = make3d(server.url, dir);
  await local3d.install('small');
  await wait3d(local3d, (status) => !status.installing);
  await local3d.install('big');
  await wait3d(local3d, (status) => status.installing?.received === half3d);
  expect(local3d.remove('small')).toBe(true);
  expect(existsSync(join(dir, 'venv'))).toBe(true);
  await local3d.cancelInstall();
  expect(existsSync(join(dir, 'venv'))).toBe(true);
  expect(local3d.remove('big')).toBe(true);
  expect(existsSync(dir)).toBe(false);
});

test('3D models: a model stopped while its code downloads can be resumed or deleted', async () => {
  const server = await serve(bodies3d, (request, response) => request.url === '/code.zip' ? sendCut(request, response, parts3d['code.zip'], half, true) : false);
  const dir = join(tempDir(), '3d');
  const local3d = make3d(server.url, dir, true);
  await local3d.install('small');
  await wait3d(local3d, (status) => status.installing?.received === half);
  await local3d.cancelInstall();
  expect((await local3d.status()).models[1]).toMatchObject({ installed: false, partial: half });
  expect(local3d.remove('small')).toBe(true);
  expect(existsSync(dir)).toBe(false);
});

test('the video tool continues its unfinished download too', async () => {
  const zip = randomBytes(300_000);
  const server = await serve({ '/ffmpeg.zip': zip }, (request, response, nth) => nth === 1 ? sendCut(request, response, zip, half, true) : false);
  const ffmpeg = createFfmpeg({
    dir: tempDir(), platform: 'win32', arch: 'x64', env: {}, fetchImpl: (_url, init) => fetch(`${server.url}/ffmpeg.zip`, init), builds: { 'win32-x64': { asset: 'ffmpeg.zip', sha256: sha(zip), bytes: zip.length } },
    extract: async (_zip, dest) => { mkdirSync(join(dest, 'build', 'bin'), { recursive: true }); writeFileSync(join(dest, 'build', 'bin', 'ffmpeg.exe'), 'binary'); },
  });
  ffmpeg.download();
  await wait(() => ffmpeg.status().downloading?.received === half);
  ffmpeg.cancelDownload();
  await wait(() => !ffmpeg.status().downloading);
  ffmpeg.download();
  await wait(() => !ffmpeg.status().downloading);
  expect(server.requests.map((item) => item.range)).toEqual([undefined, `bytes=${half}-`]);
  expect(ffmpeg.status()).toMatchObject({ installed: true, error: null });
});
