import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { toolDefs } from './tool-defs.mjs';

const MAX_BODY = 100_000;
const MAX_RESULT = 20_000;

/**
 * Local HTTP bridge between the MCP server (started by an agent CLI) and the app window.
 * Every agent run gets its own token; a call is forwarded to the renderer and answered by `settle`.
 */
export function createToolBridge({ dispatch, timeoutMs = 15 * 60_000 }) {
  const tokens = new Set();
  const pending = new Map();
  let server;

  const authorized = (header) => {
    const given = Buffer.from(String(header ?? '').replace(/^Bearer /, ''));
    for (const token of tokens) {
      const expected = Buffer.from(token);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return token;
    }
    return undefined;
  };

  function settle(callId, result) {
    const call = pending.get(callId);
    if (!call) return;
    pending.delete(callId);
    clearTimeout(call.timer);
    const text = typeof result?.text === 'string' ? result.text.slice(0, MAX_RESULT) : '';
    const images = Array.isArray(result?.images) && result.images.length <= 10 && result.images.every((url) =>
      typeof url === 'string' && url.length <= 200_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) ? result.images : undefined;
    call.resolve({ text, isError: !!result?.isError, ...(images?.length ? { images } : {}) });
  }

  function handle(request, response) {
    const reply = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    const token = request.method === 'POST' && request.url === '/call' ? authorized(request.headers.authorization) : undefined;
    if (!token) return reply(403, { text: 'Forbidden', isError: true });
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) request.destroy();
    });
    request.on('end', () => {
      let call;
      try { call = JSON.parse(body); } catch { return reply(400, { text: 'Invalid request', isError: true }); }
      if (!toolDefs.some((tool) => tool.name === call?.name)) return reply(400, { text: 'Unknown tool', isError: true });
      const callId = randomUUID();
      const timer = setTimeout(() => settle(callId, { text: 'Timed out waiting for Lomra', isError: true }), timeoutMs);
      pending.set(callId, { token, timer, resolve: (result) => reply(200, result) });
      try { dispatch(callId, call.name, call.args && typeof call.args === 'object' ? call.args : {}); }
      catch (error) { settle(callId, { text: error.message, isError: true }); }
    });
  }

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handle);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      });
    },
    issue() {
      const token = randomBytes(24).toString('hex');
      tokens.add(token);
      return token;
    },
    /** Forget a run's token and fail its unanswered calls. */
    revoke(token) {
      tokens.delete(token);
      for (const [callId, call] of pending) if (call.token === token) settle(callId, { text: 'The agent run ended', isError: true });
    },
    settle,
    close() { server?.close(); },
  };
}

/** Extra command-line options that give one agent run access to the app's tools, plus its cleanup. */
export function toolConfig({ id, port, token, runId, serverPath, execPath, dir }) {
  const env = { ELECTRON_RUN_AS_NODE: '1', BRIDGE_URL: `http://127.0.0.1:${port}/call`, BRIDGE_TOKEN: token };
  if (id === 'codex') {
    const toml = (value) => JSON.stringify(value);
    const table = `{${Object.entries(env).map(([key, value]) => `${key}=${toml(value)}`).join(',')}}`;
    return {
      args: ['-c', `mcp_servers.lomra.command=${toml(execPath)}`, '-c', `mcp_servers.lomra.args=[${toml(serverPath)}]`, '-c', `mcp_servers.lomra.env=${table}`, '-c', 'mcp_servers.lomra.tool_timeout_sec=900'],
      dispose() {},
    };
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${runId}.json`);
  writeFileSync(file, JSON.stringify({ mcpServers: { lomra: { command: execPath, args: [serverPath], env } } }), { mode: 0o600 });
  return {
    args: ['--mcp-config', file, '--strict-mcp-config', '--allowedTools', 'mcp__lomra'],
    dispose() { rmSync(file, { force: true }); },
  };
}
