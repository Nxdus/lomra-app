import { spawn as spawnProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, extname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { claudeWindows } from './limits.mjs';

/** The only commands the UI may start. The renderer sends an id, never a command line. */
export const presets = [
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
];

/** Reasoning effort levels each agent accepts. */
export const efforts = { claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['low', 'medium', 'high', 'xhigh'] };

const MAX_REPLAY = 200_000;
const MAX_WRITE = 1_000_000;
const MAX_PROMPT = 100_000;
const NEWLINE = String.fromCharCode(10);
const safeId = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/;
const safeModel = /^[A-Za-z0-9][A-Za-z0-9._-]{0,122}(?:\[1m\])?$/;

async function agentModels(id, env) {
  if (id === 'claude') return ['Fable', 'Opus', 'Sonnet', 'Haiku'].map((name) => ({ id: name.toLowerCase(), name }));
  if (id !== 'codex') return [];
  try {
    const { models } = JSON.parse(await readFile(join(env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8'));
    const available = models.filter((item) => item?.visibility === 'list' && typeof item.slug === 'string' && safeModel.test(item.slug))
      .map((item) => ({ id: item.slug, name: typeof item.display_name === 'string' ? item.display_name : item.slug }));
    if (available.length) return available;
  } catch { /* Codex may not have cached its account's catalog yet. */ }
  return [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }, { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }, { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }];
}

/** Fixed command lines for one non-interactive turn. The prompt goes through stdin, never through arguments. */
export function chatArgs(id, sessionId, extra = [], model, effort) {
  if (sessionId !== undefined && !safeId.test(sessionId)) throw new Error('Invalid session');
  if (model !== undefined && (typeof model !== 'string' || !safeModel.test(model))) throw new Error('Invalid model');
  if (effort !== undefined && !efforts[id]?.includes(effort)) throw new Error('Invalid effort');
  const modelArgs = model ? ['--model', model] : [];
  if (id === 'claude') {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...(sessionId ? ['--resume', sessionId] : []), ...modelArgs, ...(effort ? ['--effort', effort] : []), ...extra];
  }
  if (id === 'codex') {
    return ['exec', ...extra, ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []), ...(sessionId ? ['resume'] : []), ...modelArgs, '--json', '--skip-git-repo-check', ...(sessionId ? [sessionId] : []), '-'];
  }
  if (id === 'opencode') {
    return ['run', '--format', 'json', ...(sessionId ? ['--session', sessionId] : []), ...modelArgs, ...extra];
  }
  throw new Error('Unknown agent');
}

/** Turn one line of an agent's JSON stream into neutral events: text, tool, session, limits, done, error. */
export function parseChatLine(id, line) {
  let data;
  try { data = JSON.parse(line); } catch { return []; }
  if (!data || typeof data !== 'object') return [];
  if (id === 'claude') {
    if (data.type === 'system' && data.subtype === 'init' && data.session_id) return [{ type: 'session', sessionId: data.session_id }];
    if (data.type === 'stream_event' && data.event?.type === 'content_block_delta' && data.event.delta?.type === 'text_delta') return [{ type: 'text', text: data.event.delta.text }];
    if (data.type === 'assistant') {
      return (data.message?.content ?? []).filter((block) => block.type === 'tool_use').map((block) => ({ type: 'tool', name: String(block.name) }));
    }
    if (data.type === 'result') return data.is_error ? [{ type: 'error', message: String(data.result || 'Agent failed') }] : [{ type: 'done' }];
    if (data.type === 'rate_limit_event') {
      const windows = claudeWindows(data.rate_limit_info);
      return windows.length ? [{ type: 'limits', windows }] : [];
    }
    return [];
  }
  if (id === 'opencode') {
    if (data.type === 'step_start' && typeof data.sessionID === 'string') return [{ type: 'session', sessionId: data.sessionID }];
    if (data.type === 'text' && typeof data.part?.text === 'string') return [{ type: 'text', text: data.part.text }];
    if (data.type === 'tool_use') return [{ type: 'tool', name: String(data.part?.tool ?? 'tool') }];
    if (data.type === 'step_finish' && data.part?.reason === 'stop') return [{ type: 'done' }];
    if (data.type === 'error') return [{ type: 'error', message: String(data.error?.data?.message ?? data.error?.message ?? 'Agent failed') }];
    return [];
  }
  if (data.type === 'thread.started') return [{ type: 'session', sessionId: data.thread_id }];
  if (data.type === 'item.started' && data.item?.type === 'command_execution') return [{ type: 'tool', name: 'command' }];
  if (data.type === 'item.completed' && data.item?.type === 'agent_message') return [{ type: 'text', text: data.item.text }];
  if (data.type === 'turn.completed') return [{ type: 'done' }];
  if (data.type === 'turn.failed') return [{ type: 'error', message: String(data.error?.message ?? 'Agent failed') }];
  return [];
}

/** The few numbers worth showing from `opencode stats --json`. */
export function openCodeStats(data) {
  const count = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
  const tokens = data?.tokens ?? {};
  return {
    days: 7,
    sessions: count(data?.sessions),
    prompts: count(data?.prompts),
    tokens: count(tokens.input) + count(tokens.output) + count(tokens.reasoning) + count(tokens.cache?.read) + count(tokens.cache?.write),
    cost: count(data?.cost),
  };
}

/** Find an executable on PATH. On Windows only PATHEXT entries count: npm also leaves extensionless shell shims. */
export function resolveCommand(command, env = process.env, platform = process.platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').toLowerCase().split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = join(dir, command + extension);
      try {
        if (statSync(file).isFile()) return file;
      } catch { /* try the next candidate */ }
    }
  }
  return undefined;
}

/** `.cmd`/`.bat` shims cannot be spawned directly on Windows, so run them through cmd.exe. */
export function spawnSpec(file, platform = process.platform, env = process.env) {
  if (platform === 'win32' && ['.cmd', '.bat'].includes(extname(file).toLowerCase())) {
    return { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${file}"`] };
  }
  return { file, args: [] };
}

/** The agent must not inherit this app's own settings or secrets. */
export function agentEnv(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('LOMRA_')));
  return { ...clean, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

/** IPC is accepted only from the app's own top-level page. */
export function isTrustedSender(event, origin) {
  try {
    return event.senderFrame === event.sender.mainFrame && new URL(event.senderFrame.url).origin === origin;
  } catch {
    return false;
  }
}

const size = (value) => Math.min(500, Math.max(1, Math.trunc(Number(value)) || 80));

/** Pseudo-terminal sessions, one per preset, running in the workspace folder. */
export function createAgentSessions({ pty, cwd, env = process.env, platform = process.platform, emit, spawn = spawnProcess, tools }) {
  const sessions = new Map();
  const runs = new Map();

  function probeAgent(id, request) {
    const preset = presets.find((item) => item.id === id);
    const file = preset && (id === 'claude' || id === 'codex') && resolveCommand(preset.command, env, platform);
    if (!file) return Promise.resolve(null);
    const spec = spawnSpec(file, platform, env);
    const claudeCatalog = id === 'claude' && request?.type === 'control_request';
    const args = claudeCatalog
      ? ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}']
      : id === 'claude' ? ['auth', 'status'] : ['app-server'];
    const shim = spec.args.length > 0;
    const argv = shim ? [...spec.args.slice(0, -1), `"${spec.args.at(-1)} ${args.join(' ')}"`] : args;
    return new Promise((resolve) => {
      const proc = spawn(spec.file, argv, { cwd, env: agentEnv(env), windowsHide: true, windowsVerbatimArguments: shim, stdio: ['pipe', 'pipe', 'ignore'] });
      const lines = createInterface({ input: proc.stdout });
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        lines.close();
        proc.stdin.end();
        proc.stdout.destroy();
        if (proc.exitCode === null) proc.kill();
        resolve(result);
      };
      const timeout = setTimeout(() => finish(null), 5000);
      proc.on('error', () => finish(null));
      proc.stdin.on('error', () => finish(null));
      const send = (message) => proc.stdin.write(JSON.stringify(message) + NEWLINE);

      if (claudeCatalog) {
        lines.on('line', (line) => {
          let reply;
          try { reply = JSON.parse(line); } catch { return; }
          if (reply.type === 'control_response' && reply.response?.request_id === request.request_id) {
            finish(reply.response.response);
          }
        });
        proc.on('close', () => finish(null));
        proc.stdin.end(JSON.stringify(request) + NEWLINE);
      } else if (id === 'claude') {
        let output = '';
        lines.on('line', (line) => { output += line + NEWLINE; });
        proc.on('close', (code) => {
          if (code !== 0) return finish(null);
          try {
            finish(JSON.parse(output));
          } catch { finish(null); }
        });
      } else {
        lines.on('line', (line) => {
          if (finished) return;
          let reply;
          try { reply = JSON.parse(line); } catch { return; }
          if (reply?.id === 0 && reply.result) {
            send({ method: 'initialized' });
            send({ id: 1, ...request });
          } else if (reply?.id === 0 || reply?.id === 1) {
            finish(reply.id === 1 ? reply.result : null);
          }
        });
        proc.on('close', () => finish(null));
        send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'lomra', version: '0.1.0' } } });
      }
    });
  }

  return {
    list() {
      return presets.map(({ id, label, command }) => ({ id, label, available: !!resolveCommand(command, env, platform) }));
    },
    async models(id) {
      if (id === 'claude') {
        const reply = await probeAgent(id, { type: 'control_request', request_id: 'lomra-model-list', request: { subtype: 'list_models' } });
        const available = new Map();
        if (Array.isArray(reply?.models)) for (const item of reply.models) {
          const model = item?.resolvedModel ?? item?.value;
          if (item?.disabled || item?.value === 'default' || typeof model !== 'string' || !safeModel.test(model) || available.has(model)) continue;
          available.set(model, { id: model, name: item.displayName || model });
        }
        if (available.size) return [...available.values()];
      } else if (id === 'codex') {
        const reply = await probeAgent(id, { method: 'model/list', params: { limit: 100, includeHidden: false } });
        const available = Array.isArray(reply?.data) ? reply.data.flatMap((item) => {
          const model = item?.model ?? item?.id;
          return !item?.hidden && typeof model === 'string' && safeModel.test(model)
            ? [{ id: model, name: item.displayName || model }]
            : [];
        }) : [];
        if (available.length) return available;
      }
      return agentModels(id, env);
    },
    /** OpenCode keeps no plan quota, so show what its own `stats` command reports for the last 7 days. */
    stats(id) {
      const preset = id === 'opencode' ? presets.find((item) => item.id === id) : undefined;
      const file = preset && resolveCommand(preset.command, env, platform);
      if (!file) return Promise.resolve(null);
      const spec = spawnSpec(file, platform, env);
      return new Promise((resolve) => {
        let output = '';
        let proc;
        const finish = (value) => { clearTimeout(timeout); if (proc?.exitCode === null) proc.kill(); resolve(value); };
        const timeout = setTimeout(() => finish(null), 15_000);
        try {
          const args = ['stats', '--days', '7', '--json'];
          const shim = spec.args.length > 0;
          const argv = shim ? [...spec.args.slice(0, -1), `"${spec.args.at(-1)} ${args.join(' ')}"`] : args;
          proc = spawn(spec.file, argv, { cwd, env: agentEnv(env), windowsHide: true, windowsVerbatimArguments: shim, stdio: ['ignore', 'pipe', 'ignore'] });
        } catch { return finish(null); }
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => { output = (output + chunk).slice(0, 2_000_000); });
        proc.on('error', () => finish(null));
        proc.on('close', () => {
          try { finish(openCodeStats(JSON.parse(output))); } catch { finish(null); }
        });
      });
    },
    async accountEmail(id) {
      const reply = await probeAgent(id, { method: 'account/read', params: { refreshToken: false } });
      const email = id === 'claude' && reply?.loggedIn ? reply.email : reply?.account?.type === 'chatgpt' ? reply.account.email : null;
      return typeof email === 'string' && email.trim() ? email.trim() : null;
    },
    async hasCodexSubscription() {
      const reply = await probeAgent('codex', { method: 'account/read', params: { refreshToken: false } });
      const account = reply?.account;
      return account?.type === 'chatgpt' && typeof account.planType === 'string' &&
        account.planType !== '' && !['free', 'unknown'].includes(account.planType);
    },
    start(id, cols, rows) {
      const preset = presets.find((item) => item.id === id);
      if (!preset) throw new Error('Unknown agent');
      const existing = sessions.get(id);
      if (existing) {
        existing.proc.resize(size(cols), size(rows));
        return { replay: existing.buffer };
      }
      const file = resolveCommand(preset.command, env, platform);
      if (!file) throw new Error(`${preset.label} was not found on PATH`);
      const spec = spawnSpec(file, platform, env);
      const proc = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: size(cols), rows: size(rows), cwd, env: agentEnv(env) });
      const session = { proc, buffer: '' };
      sessions.set(id, session);
      proc.onData((data) => {
        session.buffer = (session.buffer + data).slice(-MAX_REPLAY);
        emit('data', { id, data });
      });
      proc.onExit(({ exitCode }) => {
        if (sessions.get(id) === session) sessions.delete(id);
        emit('exit', { id, exitCode });
      });
      return { replay: '' };
    },
    write(id, data) {
      if (typeof data === 'string' && data.length <= MAX_WRITE) sessions.get(id)?.proc.write(data);
    },
    resize(id, cols, rows) {
      sessions.get(id)?.proc.resize(size(cols), size(rows));
    },
    kill(id) {
      sessions.get(id)?.proc.kill();
    },
    /** One chat turn in the background. Output arrives through emit('chat', { runId, event }). */
    chat(runId, id, prompt, sessionId, model, effort) {
      if (typeof runId !== 'string' || !safeId.test(runId) || runs.has(runId)) throw new Error('Invalid run');
      const preset = presets.find((item) => item.id === id);
      if (!preset) throw new Error('Unknown agent');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) throw new Error('Invalid prompt');
      chatArgs(id, sessionId, [], model, effort);
      const file = resolveCommand(preset.command, env, platform);
      if (!file) throw new Error(`${preset.label} was not found on PATH`);
      const spec = spawnSpec(file, platform, env);
      // `tools` gives the run access to the app's own tools through a per-run MCP config.
      const access = tools?.prepare(runId, id);
      let proc;
      try {
        const args = chatArgs(id, sessionId, access?.args, model, effort);
        proc = spawn(spec.file, [...spec.args, ...args], { cwd, env: { ...agentEnv(env), ...(access && { MCP_TOOL_TIMEOUT: '900000' }) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        access?.dispose();
        throw error;
      }
      const run = { proc, finished: false };
      runs.set(runId, run);
      const send = (event) => {
        if (run.finished) return;
        if (event.type === 'done' || event.type === 'error') run.finished = true;
        emit('chat', { runId, event });
      };
      let pending = '';
      let errors = '';
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split(NEWLINE);
        pending = lines.pop() ?? '';
        for (const line of lines) parseChatLine(id, line.trim()).forEach(send);
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
      proc.on('error', (error) => send({ type: 'error', message: error.message }));
      proc.on('close', (code) => {
        parseChatLine(id, pending.trim()).forEach(send);
        runs.delete(runId);
        access?.dispose();
        send(code === 0 ? { type: 'done' } : { type: 'error', message: errors.trim().split(NEWLINE).pop() || `${preset.label} exited with code ${code}` });
      });
      proc.stdin.on('error', () => {});
      proc.stdin.end(prompt);
    },
    cancelChat(runId) {
      runs.get(runId)?.proc.kill();
    },
    killAll() {
      for (const { proc } of sessions.values()) proc.kill();
      for (const { proc } of runs.values()) proc.kill();
    },
  };
}
