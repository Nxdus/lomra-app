import { statSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';

/** The only commands the UI may start. The renderer sends an id, never a command line. */
export const presets = [
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
];

const MAX_REPLAY = 200_000;
const MAX_WRITE = 1_000_000;

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
export function createAgentSessions({ pty, cwd, env = process.env, platform = process.platform, emit }) {
  const sessions = new Map();

  return {
    list() {
      return presets.map(({ id, label, command }) => ({ id, label, available: !!resolveCommand(command, env, platform) }));
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
    killAll() {
      for (const { proc } of sessions.values()) proc.kill();
    },
  };
}
