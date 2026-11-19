// Minimal MCP server (stdio, newline-delimited JSON-RPC) started by the agent CLI. It forwards tool calls to the
// app over the local bridge. Run with ELECTRON_RUN_AS_NODE; BRIDGE_URL and BRIDGE_TOKEN come from the MCP config.
import http from 'node:http';
import { createInterface } from 'node:readline';
import { toolDefs } from './tool-defs.mjs';

const url = new URL(process.env.BRIDGE_URL ?? 'http://127.0.0.1:1');
const token = process.env.BRIDGE_TOKEN ?? '';

// No client timeout: generation can take minutes and the app enforces its own limit.
function callApp(name, args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ name, args });
    const request = http.request(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(text)); } catch { resolve({ text: `Lomra returned HTTP ${response.statusCode}`, isError: true }); }
      });
    });
    request.on('error', (error) => resolve({ text: `Could not reach Lomra: ${error.message}`, isError: true }));
    request.end(body);
  });
}

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

async function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return; // notifications need no reply
  if (method === 'initialize') {
    return write({ id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'lomra', version: '0.1.0' } } });
  }
  if (method === 'ping') return write({ id, result: {} });
  if (method === 'tools/list') return write({ id, result: { tools: toolDefs } });
  if (method === 'tools/call') {
    if (!toolDefs.some((tool) => tool.name === params?.name)) return write({ id, error: { code: -32602, message: 'Unknown tool' } });
    const result = await callApp(params.name, params.arguments ?? {});
    const content = [{ type: 'text', text: String(result.text ?? '') }];
    for (const [index, url] of (result.images ?? []).entries()) {
      content.push({ type: 'text', text: `Selected image index ${index}` }, { type: 'image', mimeType: 'image/jpeg', data: url.slice('data:image/jpeg;base64,'.length) });
    }
    return write({ id, result: { content, isError: !!result.isError } });
  }
  write({ id, error: { code: -32601, message: 'Method not found' } });
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  void handle(message);
});
