import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createToolBridge, toolConfig } from './tool-bridge.mjs';

async function call(port, token, body) {
  const response = await fetch(`http://127.0.0.1:${port}/call`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('the bridge forwards calls for valid tokens only and settles them from the app', async () => {
  const calls = [];
  const bridge = createToolBridge({ dispatch: (callId, name, args) => calls.push({ callId, name, args }) });
  const port = await bridge.listen();
  const token = bridge.issue();
  expect((await call(port, 'wrong', { name: 'canvas_selection' })).status).toBe(403);
  expect((await call(port, token, { name: 'rm_rf' })).status).toBe(400);
  const pending = call(port, token, { name: 'generate_image', args: { prompt: 'cat' } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls[0]).toMatchObject({ name: 'generate_image', args: { prompt: 'cat' } });
  bridge.settle(calls[0].callId, { text: 'done', isError: false });
  expect(await pending).toEqual({ status: 200, body: { text: 'done', isError: false } });

  const open = call(port, token, { name: 'canvas_selection' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  bridge.revoke(token);
  expect((await open).body.isError).toBe(true);
  expect((await call(port, token, { name: 'canvas_selection' })).status).toBe(403);
  bridge.close();
});

test('tool config adds one MCP server per agent', () => {
  const base = { port: 1234, token: 'tok', runId: 'run1', serverPath: '/app/mcp-server.mjs', execPath: '/app/electron', dir: '/tmp/lomra-test-mcp' };
  const codex = toolConfig({ ...base, id: 'codex' });
  expect(codex.args.join(' ')).toContain('mcp_servers.lomra.command="/app/electron"');
  expect(codex.args.join(' ')).toContain('BRIDGE_TOKEN="tok"');
  const claude = toolConfig({ ...base, id: 'claude' });
  expect(claude.args).toContain('--strict-mcp-config');
  claude.dispose();
});

test('the MCP server returns selected previews as indexed image content', async () => {
  const bridge = createToolBridge({ dispatch(callId, name, args) {
    expect(name).toBe('canvas_selection');
    expect(args).toEqual({ include_images: true });
    bridge.settle(callId, { text: 'Selected files', images: ['data:image/jpeg;base64,/9j/'] });
  } });
  const port = await bridge.listen();
  try {
    const request = { id: 1, method: 'tools/call', params: { name: 'canvas_selection', arguments: { include_images: true } } };
    const proc = Bun.spawn([process.execPath, fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], {
      env: { ...process.env, BRIDGE_URL: `http://127.0.0.1:${port}/call`, BRIDGE_TOKEN: bridge.issue() },
      stdin: new Blob([JSON.stringify(request) + '\n']), stdout: 'pipe',
    });
    const reply = JSON.parse(await new Response(proc.stdout).text());
    expect(await proc.exited).toBe(0);
    expect(reply.result.content).toEqual([
      { type: 'text', text: 'Selected files' },
      { type: 'text', text: 'Selected image index 0' },
      { type: 'image', mimeType: 'image/jpeg', data: '/9j/' },
    ]);
  } finally {
    bridge.close();
  }
});
