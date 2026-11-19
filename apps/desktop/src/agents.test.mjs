import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { agentEnv, chatArgs, openCodeStats, createAgentSessions, parseChatLine, isTrustedSender, resolveCommand, spawnSpec } from './agents.mjs';

const NEWLINE = String.fromCharCode(10);

test('accountEmail requests the signed-in Codex account without refreshing tokens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-account-'));
  const windows = process.platform === 'win32';
  writeFileSync(join(dir, windows ? 'codex.exe' : 'codex'), '');
  const requests = [];
  let account = { type: 'chatgpt', email: 'user@example.com', planType: 'plus' };
  const agents = createAgentSessions({
    cwd: dir,
    env: { PATH: dir },
    spawn(_file, args) {
      expect(args).toEqual(['app-server']);
      const proc = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), exitCode: null,
        kill() { this.exitCode = 0; },
      });
      proc.stdin.on('data', (chunk) => {
        const request = JSON.parse(chunk.toString());
        requests.push(request);
        if (request.id === 0) proc.stdout.write('{"id":0,"result":{}}\n');
        if (request.method === 'account/read') proc.stdout.write(JSON.stringify({ id: 1, result: { account } }) + NEWLINE);
        if (request.method === 'model/list') proc.stdout.write(JSON.stringify({ id: 1, result: { data: [
          { id: 'option-id', model: 'gpt-6.2-sol', displayName: 'GPT-6.2-Sol', hidden: false },
          { model: 'internal', hidden: true },
        ] } }) + NEWLINE);
      });
      return proc;
    },
  });
  expect(await agents.accountEmail('codex')).toBe('user@example.com');
  expect(requests.map(({ method }) => method)).toEqual(['initialize', 'initialized', 'account/read']);
  expect(requests.at(-1).params).toEqual({ refreshToken: false });
  expect(await agents.accountEmail('unknown')).toBeNull();
  expect(await agents.models('codex')).toEqual([{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }]);
  expect(requests.at(-1).method).toBe('model/list');
  expect(await agents.hasCodexSubscription()).toBe(true);
  for (const planType of ['free', 'unknown', undefined]) {
    account = { ...account, planType };
    expect(await agents.hasCodexSubscription()).toBe(false);
  }
  account = { type: 'apiKey' };
  expect(await agents.hasCodexSubscription()).toBe(false);
});

function fakePty() {
  const spawned = [];
  return {
    spawned,
    spawn(file, args, options) {
      const proc = {
        file, args, options, written: [], killed: false, size: [options.cols, options.rows],
        write(data) { this.written.push(data); },
        resize(cols, rows) { this.size = [cols, rows]; },
        kill() { this.killed = true; },
        onData(callback) { this.data = callback; },
        onExit(callback) { this.exit = callback; },
      };
      spawned.push(proc);
      return proc;
    },
  };
}

test('resolveCommand ignores extensionless shims on Windows and finds PATHEXT files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-path-'));
  writeFileSync(join(dir, 'tool'), '');
  writeFileSync(join(dir, 'tool.cmd'), '');
  const env = { PATH: dir, PATHEXT: '.EXE;.CMD' };
  expect(resolveCommand('tool', env, 'win32')).toBe(join(dir, 'tool.cmd'));
  expect(resolveCommand('tool', env, 'linux')).toBe(join(dir, 'tool'));
  expect(resolveCommand('missing', { PATH: dir + delimiter }, 'linux')).toBeUndefined();
});

test('cmd shims run through cmd.exe and the agent does not inherit app secrets', () => {
  expect(spawnSpec('C:\\bin\\claude.cmd', 'win32', { ComSpec: 'cmd.exe' })).toEqual({ file: 'cmd.exe', args: ['/d', '/s', '/c', '"C:\\bin\\claude.cmd"'] });
  expect(spawnSpec('C:\\bin\\claude.exe', 'win32')).toEqual({ file: 'C:\\bin\\claude.exe', args: [] });
  const env = agentEnv({ PATH: 'x', LOMRA_SECRET: 's', LOMRA_DATA_DIR: 'd', ELECTRON_RUN_AS_NODE: '1' });
  expect(env).toEqual({ PATH: 'x', TERM: 'xterm-256color', COLORTERM: 'truecolor' });
});

test('only the top-level page of the app origin is trusted', () => {
  const main = {};
  const trusted = { senderFrame: { url: 'http://127.0.0.1:3000/x' }, sender: { mainFrame: null } };
  trusted.senderFrame = Object.assign(main, trusted.senderFrame);
  trusted.sender.mainFrame = main;
  expect(isTrustedSender(trusted, 'http://127.0.0.1:3000')).toBe(true);
  expect(isTrustedSender(trusted, 'http://127.0.0.1:3001')).toBe(false);
  expect(isTrustedSender({ senderFrame: { url: 'http://127.0.0.1:3000' }, sender: { mainFrame: {} } }, 'http://127.0.0.1:3000')).toBe(false);
  expect(isTrustedSender({}, 'http://127.0.0.1:3000')).toBe(false);
});

test('sessions start only presets, run in the workspace and replay output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-bin-'));
  writeFileSync(join(dir, 'claude'), '');
  const pty = fakePty();
  const events = [];
  const sessions = createAgentSessions({ pty, cwd: '/work', env: { PATH: dir, LOMRA_SECRET: 's' }, platform: 'linux', emit: (type, payload) => events.push([type, payload]) });
  expect(sessions.list()).toEqual([{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex', available: false }, { id: 'opencode', label: 'OpenCode', available: false }]);
  expect(() => sessions.start('rm -rf /', 80, 24)).toThrow('Unknown agent');
  expect(() => sessions.start('codex', 80, 24)).toThrow('not found');

  expect(sessions.start('claude', 100, 30)).toEqual({ replay: '' });
  const [proc] = pty.spawned;
  expect(proc.options.cwd).toBe('/work');
  expect(proc.options.env.LOMRA_SECRET).toBeUndefined();
  proc.data('hello');
  expect(events).toEqual([['data', { id: 'claude', data: 'hello' }]]);

  expect(sessions.start('claude', 120, 40)).toEqual({ replay: 'hello' });
  expect(pty.spawned).toHaveLength(1);
  expect(proc.size).toEqual([120, 40]);

  sessions.write('claude', 'ls\r');
  sessions.write('claude', 42);
  sessions.resize('claude', 99999, 0);
  expect(proc.written).toEqual(['ls\r']);
  expect(proc.size).toEqual([500, 80]);

  proc.exit({ exitCode: 0 });
  expect(events.at(-1)).toEqual(['exit', { id: 'claude', exitCode: 0 }]);
  expect(sessions.start('claude', 80, 24)).toEqual({ replay: '' });
  expect(pty.spawned).toHaveLength(2);
  sessions.killAll();
  expect(pty.spawned[1].killed).toBe(true);
});

test('chat arguments are fixed and session ids are validated', () => {
  expect(chatArgs('claude')).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
  expect(chatArgs('claude', 'abc-1')).toContain('--resume');
  expect(chatArgs('codex', 'abc-1')).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check', 'abc-1', '-']);
  expect(chatArgs('claude', undefined, [], 'opus')).toEqual([...chatArgs('claude'), '--model', 'opus']);
  expect(chatArgs('codex', 'abc-1', [], 'gpt-6.2-sol')).toEqual(['exec', 'resume', '--model', 'gpt-6.2-sol', '--json', '--skip-git-repo-check', 'abc-1', '-']);
  expect(() => chatArgs('codex', undefined, [], '--config')).toThrow('Invalid model');
  expect(() => chatArgs('claude', undefined, [], 'opus&echo')).toThrow('Invalid model');
  expect(() => chatArgs('codex', '--dangerous')).toThrow('Invalid session');
  expect(() => chatArgs('sh')).toThrow('Unknown agent');
  expect(chatArgs('claude', undefined, [], undefined, 'max')).toEqual([...chatArgs('claude'), '--effort', 'max']);
  expect(chatArgs('codex', undefined, [], undefined, 'high')).toEqual(['exec', '-c', 'model_reasoning_effort="high"', '--json', '--skip-git-repo-check', '-']);
  expect(() => chatArgs('codex', undefined, [], undefined, 'max')).toThrow('Invalid effort');
  expect(() => chatArgs('claude', undefined, [], undefined, 'low"; rm')).toThrow('Invalid effort');
  expect(() => chatArgs('opencode', undefined, [], undefined, 'low')).toThrow('Invalid effort');
  expect(chatArgs('opencode', 'ses_abc')).toEqual(['run', '--format', 'json', '--session', 'ses_abc']);
  expect(parseChatLine('opencode', '{"type":"text","part":{"text":"hi"}}')).toEqual([{ type: 'text', text: 'hi' }]);
  expect(parseChatLine('opencode', '{"type":"step_finish","part":{"reason":"tool-calls"}}')).toEqual([]);
  expect(parseChatLine('opencode', '{"type":"step_finish","part":{"reason":"stop"}}')).toEqual([{ type: 'done' }]);
});

test('agent JSON lines become neutral events', () => {
  const line = (value) => JSON.stringify(value);
  expect(parseChatLine('claude', line({ type: 'system', subtype: 'init', session_id: 's1' }))).toEqual([{ type: 'session', sessionId: 's1' }]);
  expect(parseChatLine('claude', line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }))).toEqual([{ type: 'text', text: 'hi' }]);
  expect(parseChatLine('claude', line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Read' }] } }))).toEqual([{ type: 'tool', name: 'Read' }]);
  expect(parseChatLine('claude', line({ type: 'result', is_error: true, result: 'nope' }))).toEqual([{ type: 'error', message: 'nope' }]);
  expect(parseChatLine('codex', line({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }))).toEqual([{ type: 'text', text: 'hi' }]);
  expect(parseChatLine('codex', line({ type: 'turn.completed' }))).toEqual([{ type: 'done' }]);
  expect(parseChatLine('claude', line({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.16, resetsAt: 100 } } } }))).toEqual([{ type: 'limits', windows: [{ id: 'five_hour', label: '5 hr', usedPercent: 16, resetsAt: 100 }] }]);
  expect(parseChatLine('codex', 'not json')).toEqual([]);
});

test('a chat run feeds the prompt through stdin and streams events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-chat-'));
  writeFileSync(join(dir, 'codex'), '');
  const calls = [];
  const spawn = (file, args, options) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, kill() { this.killed = true; } });
    proc.input = '';
    proc.stdin.on('data', (chunk) => { proc.input += chunk; });
    calls.push({ file, args, options, proc });
    return proc;
  };
  const events = [];
  const sessions = createAgentSessions({ pty: fakePty(), cwd: '/work', env: { PATH: dir, LOMRA_SECRET: 's' }, platform: 'linux', emit: (type, payload) => events.push([type, payload]), spawn });
  expect(() => sessions.chat('run 1', 'codex', 'hi')).toThrow('Invalid run');
  expect(() => sessions.chat('run1', 'claude', 'hi')).toThrow('not found');
  expect(() => sessions.chat('run1', 'codex', '  ')).toThrow('Invalid prompt');
  sessions.chat('run1', 'codex', 'make it blue');
  const { proc, args, options } = calls[0];
  expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
  expect(options.env.LOMRA_SECRET).toBeUndefined();
  expect(proc.input).toBe('make it blue');
  expect(() => sessions.chat('run1', 'codex', 'again')).toThrow('Invalid run');
  proc.stdout.write(['{"type":"thread.started","thread_id":"t1"}', '{"type":"item.comp'].join(NEWLINE));
  proc.stdout.write(['leted","item":{"type":"agent_message","text":"ok"}}', ''].join(NEWLINE));
  proc.emit('close', 0);
  expect(events).toEqual([
    ['chat', { runId: 'run1', event: { type: 'session', sessionId: 't1' } }],
    ['chat', { runId: 'run1', event: { type: 'text', text: 'ok' } }],
    ['chat', { runId: 'run1', event: { type: 'done' } }],
  ]);
  sessions.chat('run2', 'codex', 'x');
  calls[1].proc.stderr.write(`boom${NEWLINE}`);
  calls[1].proc.emit('close', 1);
  expect(events.at(-1)).toEqual(['chat', { runId: 'run2', event: { type: 'error', message: 'boom' } }]);
  sessions.chat('run3', 'codex', 'x');
  sessions.cancelChat('run3');
  expect(calls[2].proc.killed).toBe(true);
});

test('OpenCode stats keep totals only', () => {
  expect(openCodeStats({ sessions: 4, prompts: 7, tokens: { input: 10, output: 2, reasoning: 3, cache: { read: 5, write: 0 } }, cost: 0.12, models: [{}] }))
    .toEqual({ days: 7, sessions: 4, prompts: 7, tokens: 20, cost: 0.12 });
  expect(openCodeStats(null)).toEqual({ days: 7, sessions: 0, prompts: 0, tokens: 0, cost: 0 });
});
