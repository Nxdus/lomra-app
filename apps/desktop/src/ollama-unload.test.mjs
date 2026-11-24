import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGpuQueue } from './gpu-queue.mjs';
import { isLoopback, ollamaAddress, unloadOllama } from './ollama-unload.mjs';

const cleanup = [];
afterEach(async () => { for (const undo of cleanup.splice(0)) await undo(); });

function workspace(saved) {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-unload-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  if (saved !== undefined) {
    mkdirSync(join(dir, 'settings'));
    writeFileSync(join(dir, 'settings', 'ollama-url.json'), typeof saved === 'string' ? JSON.stringify(saved) : saved.raw);
  }
  return dir;
}

/** A real HTTP server on this computer that answers like Ollama; `respond` handles one request (body already read). */
async function listen(respond) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : undefined });
    respond({ method: request.method, path: request.url, body: body ? JSON.parse(body) : undefined, json: (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }, response });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const timed = async (work) => { const start = performance.now(); await work; return performance.now() - start; };

test('the address is the saved one, else OLLAMA_URL, else this computer', () => {
  const none = workspace();
  expect(ollamaAddress(none, {})).toBe('http://127.0.0.1:11434');
  expect(ollamaAddress(none, { OLLAMA_URL: 'http://gpu-box:11434/' })).toBe('http://gpu-box:11434');
  expect(ollamaAddress(none, { OLLAMA_URL: 'not a url' })).toBe('http://127.0.0.1:11434');
  expect(ollamaAddress(workspace('http://localhost:5000'), { OLLAMA_URL: 'http://gpu-box:11434' })).toBe('http://localhost:5000');
  expect(ollamaAddress(workspace('file:///etc/passwd'), {})).toBe('http://127.0.0.1:11434');
  expect(ollamaAddress(workspace({ raw: '{broken' }), { OLLAMA_URL: 'http://gpu-box:1' })).toBe('http://gpu-box:1');
});

test('only a server on this computer is contacted', async () => {
  for (const address of ['http://127.0.0.1:11434', 'http://localhost:1', 'https://[::1]:2']) expect(isLoopback(address)).toBe(true);
  for (const address of ['http://192.168.1.5:11434', 'http://gpu-box:11434', 'https://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://0.0.0.0:11434']) expect(isLoopback(address)).toBe(false);
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return Response.json({ models: [] }); };
  await unloadOllama({ workspace: workspace('http://192.168.1.5:11434'), env: {}, fetchImpl });
  await unloadOllama({ workspace: workspace(), env: { OLLAMA_URL: 'https://ollama.example.com' }, fetchImpl });
  // A remote address the user saved wins over a local OLLAMA_URL.
  await unloadOllama({ workspace: workspace('http://gpu-box:11434'), env: { OLLAMA_URL: 'http://127.0.0.1:11434' }, fetchImpl });
  expect(seen).toEqual([]);
  await unloadOllama({ workspace: workspace(), env: {}, fetchImpl });
  expect(seen).toEqual(['http://127.0.0.1:11434/api/ps']);
});

test('a real local server: every loaded model is unloaded, and the run waits until the models are gone', async () => {
  const loaded = new Set(['qwen3:8b', 'llama3.2:3b']);
  const { url, requests } = await listen(({ method, path, body, json }) => {
    if (method === 'GET' && path === '/api/ps') return json({ models: [...loaded].map((name) => ({ name, model: name, size_vram: 5 })) });
    setTimeout(() => loaded.delete(body.model), 200);
    return json({ model: body.model, done: true, done_reason: 'unload' });
  });
  const queue = createGpuQueue({ prepare: (signal) => unloadOllama({ workspace: workspace(url), env: {}, signal, pollMs: 20 }) });
  const left = await queue.run(async () => [...loaded], { signal: new AbortController().signal });
  expect(left).toEqual([]);
  expect(requests[0]).toEqual({ method: 'GET', path: '/api/ps', body: undefined });
  const posts = requests.filter((item) => item.method === 'POST');
  expect(posts.map((item) => item.path)).toEqual(['/api/generate', '/api/generate']);
  expect(posts.map((item) => item.body).sort((a, b) => a.model.localeCompare(b.model))).toEqual([{ model: 'llama3.2:3b', keep_alive: 0 }, { model: 'qwen3:8b', keep_alive: 0 }]);
});

test('nothing is unloaded when no model is loaded', async () => {
  const { url, requests } = await listen(({ json }) => json({ models: [] }));
  await unloadOllama({ workspace: workspace(url), env: {} });
  expect(requests.map((item) => item.path)).toEqual(['/api/ps']);
});

test('a missing, hanging, failing or odd server neither fails nor holds up the run', async () => {
  const gone = await listen(({ json }) => json({}));
  const closed = gone.url;
  for (const undo of cleanup.splice(0)) await undo();
  const limits = { env: {}, requestMs: 100, waitMs: 300, pollMs: 20 };
  const servers = [
    closed,
    (await listen(() => { /* never answers */ })).url,
    (await listen(({ response }) => { response.writeHead(200); response.write('{"models":'); /* never ends */ })).url,
    (await listen(({ json }) => json({ error: 'boom' }, 500))).url,
    (await listen(({ response }) => response.end('not json'))).url,
    (await listen(({ json }) => json({ models: [null, {}, { name: 5 }, 'x'] }))).url,
    (await listen(({ path, json }) => path === '/api/ps' ? json({ models: [{ name: 'a' }] }) : json({ error: 'no' }, 500))).url,
    (await listen(({ path, json }) => { if (path === '/api/ps') json({ models: [{ name: 'a' }] }); })).url,
    // Keeps answering a chat, so the model never goes away.
    (await listen(({ path, json }) => json(path === '/api/ps' ? { models: [{ name: 'busy' }] } : { done: true }))).url,
  ];
  for (const url of servers) {
    const queue = createGpuQueue({ prepare: (signal) => unloadOllama({ ...limits, workspace: workspace(url), signal }) });
    expect(await queue.run(async () => 'ran')).toBe('ran');
    expect(await timed(unloadOllama({ ...limits, workspace: workspace(url) }))).toBeLessThan(1000);
  }
});

test('a local server cannot redirect the request to another one', async () => {
  const other = await listen(({ json }) => json({ models: [] }));
  const { url } = await listen(({ path, response }) => { response.writeHead(307, { Location: `${other.url}${path}` }); response.end(); });
  await unloadOllama({ workspace: workspace(url), env: {} });
  expect(other.requests).toEqual([]);
});

test('cancelling the run stops waiting for Ollama', async () => {
  const { url } = await listen(() => { /* never answers */ });
  const controller = new AbortController();
  const queue = createGpuQueue({ prepare: (signal) => unloadOllama({ workspace: workspace(url), env: {}, signal, requestMs: 10_000, waitMs: 10_000 }) });
  let ran = false;
  const run = queue.run(async () => { ran = true; }, { signal: controller.signal }).catch((cause) => cause.message);
  setTimeout(() => controller.abort(), 50);
  expect(await timed(run)).toBeLessThan(2000);
  expect(await run).toBe('Stopped.');
  expect(ran).toBe(false);
});
