import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const defaultOllamaUrl = 'http://127.0.0.1:11434';

/** The origin of an Ollama address, or undefined if it is not one; the same rule as the frontend's `lib/ollama-url.ts`. */
function parseOllamaUrl(value) {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return undefined;
    return url.origin;
  } catch { return undefined; }
}

/** The Ollama server the app uses: the address saved in the workspace, else OLLAMA_URL, else this computer (as `app/api/ollama/ollama.ts`). */
export function ollamaAddress(workspace, env = process.env) {
  try {
    const url = parseOllamaUrl(JSON.parse(readFileSync(join(workspace, 'settings', 'ollama-url.json'), 'utf8')));
    if (url) return url;
  } catch { /* Not set. */ }
  return parseOllamaUrl(env.OLLAMA_URL ?? '') ?? defaultOllamaUrl;
}

/** True when the server is on this computer, so its models share this graphics card. */
export const isLoopback = (address) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname);

/**
 * Frees the graphics memory Ollama holds, before a local run. Only for a server on this computer; a remote one is never
 * contacted. Best effort and bounded: a server that is missing, slow or failing costs at most `requestMs` per request, and a
 * model that stays loaded (it is answering a chat) at most `waitMs` in all. Never rejects.
 */
export async function unloadOllama({ workspace, env = process.env, fetchImpl = fetch, signal, requestMs = 1000, waitMs = 4000, pollMs = 150 }) {
  const address = ollamaAddress(workspace, env);
  if (!isLoopback(address)) return;
  const deadline = AbortSignal.any([AbortSignal.timeout(waitMs), ...(signal ? [signal] : [])]);
  // Redirects are refused, so a local server cannot send this on to another computer.
  const call = async (path, init) => {
    const response = await fetchImpl(`${address}${path}`, { ...init, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(requestMs)]) });
    const body = await response.json();
    if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
    return body;
  };
  const loaded = async () => {
    const { models } = await call('/api/ps');
    return (Array.isArray(models) ? models : []).flatMap((item) => typeof item?.name === 'string' && item.name ? [item.name] : []);
  };
  try {
    const asked = await Promise.all((await loaded()).map((model) => call('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }),
    }).then(() => model, () => undefined)));
    const going = new Set(asked.filter(Boolean));
    // The answer comes before the memory is free; it is free once the model is no longer listed.
    while (going.size && !deadline.aborted && (await loaded()).some((model) => going.has(model))) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } catch { /* Not running, slow or failing: the run goes ahead. */ }
}
