import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { agentEnv, createAgentSessions, isTrustedSender, resolveCommand, spawnSpec } from './agents.mjs';

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
  expect(sessions.list()).toEqual([{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex', available: false }]);
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
