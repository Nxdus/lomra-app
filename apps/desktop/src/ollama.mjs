import { spawn } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { agentEnv, resolveCommand } from './agents.mjs';

const isFile = (file) => { try { return statSync(file).isFile(); } catch { return false; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Ollama CLI: on PATH, or where its installer puts it when PATH has not been refreshed yet. */
export function findOllama(env = process.env, platform = process.platform, exists = isFile) {
  const onPath = resolveCommand('ollama', env, platform);
  if (onPath) return onPath;
  const candidates = platform === 'win32' ? (env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')] : [])
    : platform === 'darwin' ? ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama']
    : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  return candidates.find(exists);
}

/**
 * Finds the Ollama CLI and, when asked, runs `ollama serve` for the app. A server the user
 * started (or one set with OLLAMA_URL) is used as it is and never stopped by the app.
 */
export function createOllama({ env = process.env, platform = process.platform, spawnProcess = spawn, fetchImpl = fetch, find = findOllama, exists = isFile, removeDir = (dir) => rmSync(dir, { recursive: true, force: true }), pollMs = 500, attempts = 40, settleMs = 2000 } = {}) {
  const url = (env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  let child;
  let starting;
  let installing;
  let uninstalling;
  let installer;
  const running = () => fetchImpl(`${url}/api/version`, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok, () => false);

  async function launch() {
    if (await running()) return true;
    const file = find(env, platform);
    if (!file || env.OLLAMA_URL) return false;
    if (!child) {
      const proc = spawnProcess(file, ['serve'], { env: agentEnv(env), windowsHide: true, stdio: 'ignore' });
      child = proc;
      const forget = () => { if (child === proc) child = undefined; };
      proc.on('error', forget);
      proc.on('exit', forget);
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await running()) return true;
      if (!child) return false;
      await sleep(pollMs);
    }
    return false;
  }

  /**
   * Ollama's installer opens its own app window when it finishes, and Lomra does not need it: the
   * server is started by `ollama serve`. Only called right after Lomra's own install, never on an
   * Ollama the user has been running.
   */
  async function closeInstalledApp() {
    await sleep(settleMs);
    await new Promise((resolve) => {
      const proc = spawnProcess('taskkill', ['/IM', 'ollama app.exe', '/F'], { windowsHide: true, stdio: 'ignore' });
      proc.on('error', resolve);
      proc.on('exit', resolve);
      setTimeout(resolve, settleMs);
    });
  }

  /**
   * Installs the CLI with winget (Windows only). Resolves 'installed', 'failed', or 'manual' when this
   * computer cannot do it, in which case the caller sends the user to the download page.
   */
  function install() {
    if (platform !== 'win32') return Promise.resolve('manual');
    installing ??= winget(['install', '--id', 'Ollama.Ollama', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements']).then(async ({ error, code }) => {
      if (error) return error.code === 'ENOENT' ? 'manual' : 'failed';
      // winget exits non-zero when Ollama is already installed, so the CLI itself is the proof.
      if (code !== 0 && !find(env, platform)) return 'failed';
      await closeInstalledApp().catch(() => {});
      return 'installed';
    }).finally(() => { installing = undefined; installer = undefined; });
    return installing;
  }

  function winget(args) {
    return new Promise((resolve) => {
      const proc = spawnProcess('winget', args, { env, windowsHide: true, stdio: 'ignore' });
      installer = proc;
      proc.on('error', (error) => resolve({ error }));
      proc.on('exit', (code) => resolve({ code }));
    });
  }

  const kill = (image) => new Promise((resolve) => {
    const proc = spawnProcess('taskkill', ['/IM', image, '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    proc.on('error', resolve);
    proc.on('exit', resolve);
    setTimeout(resolve, settleMs);
  });

  function run(file, args) {
    return new Promise((resolve) => {
      const proc = spawnProcess(file, args, { env, windowsHide: true, stdio: 'ignore' });
      installer = proc;
      proc.on('error', (error) => resolve({ error }));
      proc.on('exit', (code) => resolve({ code }));
    });
  }

  /**
   * Deletes every downloaded model. Done through the server, which also handles a models folder moved
   * with OLLAMA_MODELS, and before it is stopped. Best effort: a model that cannot be removed stays.
   */
  async function removeModels() {
    try {
      if (!(await launch())) return;
      const result = await (await fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) })).json();
      for (const model of result?.models ?? []) {
        if (typeof model?.name !== 'string') continue;
        await fetchImpl(`${url}/api/delete`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.name }), signal: AbortSignal.timeout(30_000),
        }).catch(() => {});
      }
    } catch { /* Nothing to remove, or the server would not start. */ }
  }

  /**
   * Removes the CLI and the models it downloaded (Windows only). A running Ollama blocks the uninstall, and its app restarts the
   * server when only the server is stopped, so the app goes first. Ollama's own uninstaller is used
   * when it is next to the CLI, else winget.
   * Resolves 'uninstalled', 'failed' or 'manual'.
   */
  function uninstall() {
    if (platform !== 'win32') return Promise.resolve('manual');
    uninstalling ??= (async () => {
      const cli = find(env, platform);
      const uninstaller = cli && join(dirname(cli), 'unins000.exe');
      await removeModels();
      child?.kill();
      child = undefined;
      await kill('ollama app.exe');
      await kill('ollama.exe');
      const { error, code } = uninstaller && exists(uninstaller)
        ? await run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'])
        : await winget(['uninstall', '--id', 'Ollama.Ollama', '--exact', '--silent']);
      if (error) return error.code === 'ENOENT' ? 'manual' : 'failed';
      if (code !== 0 && find(env, platform)) return 'failed';
      // Whatever the server could not delete (it was not running, an old version) goes with the folder.
      // Only the default folder: a folder chosen with OLLAMA_MODELS is not ours to delete wholesale.
      if (!env.OLLAMA_MODELS) try { removeDir(join(env.USERPROFILE ?? homedir(), '.ollama', 'models')); } catch { /* In use or already gone. */ }
      return 'uninstalled';
    })().finally(() => { uninstalling = undefined; installer = undefined; });
    return uninstalling;
  }

  return {
    async status() {
      return { installed: !!find(env, platform), running: await running(), managed: !env.OLLAMA_URL, installMethod: platform === 'win32' ? 'winget' : 'download' };
    },
    install,
    uninstall,
    /** Resolves true once the server answers. */
    start() {
      starting ??= launch().finally(() => { starting = undefined; });
      return starting;
    },
    stop() { child?.kill(); child = undefined; installer?.kill(); },
  };
}
