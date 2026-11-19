import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { createOllama, findOllama } from './ollama.mjs';

test('findOllama uses PATH first, then the installer location', () => {
  const env = { PATH: '', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
  const installed = join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
  expect(findOllama(env, 'win32', (file) => file === installed)).toBe(installed);
  expect(findOllama(env, 'win32', () => false)).toBeUndefined();
  expect(findOllama({ PATH: '' }, 'win32', () => true)).toBeUndefined();
  expect(findOllama({ PATH: '' }, 'darwin', (file) => file === '/opt/homebrew/bin/ollama')).toBe('/opt/homebrew/bin/ollama');
});

function fakes(upAfter) {
  let polls = 0;
  const spawned = [];
  return {
    spawned,
    options: {
      env: {}, platform: 'linux', find: () => '/usr/bin/ollama', pollMs: 1, attempts: 5, settleMs: 1,
      fetchImpl: async () => ({ ok: upAfter !== undefined && ++polls > upAfter }),
      spawnProcess: (file, args, options) => {
        const proc = Object.assign(new EventEmitter(), { kill() { this.killed = true; } });
        spawned.push({ file, args, options, proc });
        return proc;
      },
    },
  };
}

test('start runs `ollama serve` once and waits until it answers', async () => {
  const { spawned, options } = fakes(2);
  const ollama = createOllama(options);
  expect(await Promise.all([ollama.start(), ollama.start()])).toEqual([true, true]);
  expect(spawned).toHaveLength(1);
  expect(spawned[0].file).toBe('/usr/bin/ollama');
  expect(spawned[0].args).toEqual(['serve']);
  ollama.stop();
  expect(spawned[0].proc.killed).toBe(true);
});

test('start leaves a running server alone and gives up when the CLI is missing, exits or is user-managed', async () => {
  const running = fakes(0);
  expect(await createOllama(running.options).start()).toBe(true);
  expect(running.spawned).toHaveLength(0);

  const missing = fakes();
  expect(await createOllama({ ...missing.options, find: () => undefined }).start()).toBe(false);
  expect(await createOllama({ ...missing.options, env: { OLLAMA_URL: 'http://other:11434' } }).start()).toBe(false);
  expect(missing.spawned).toHaveLength(0);

  const crashing = fakes();
  const started = createOllama(crashing.options).start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  crashing.spawned[0].proc.emit('exit', 1);
  expect(await started).toBe(false);

  expect(await createOllama(fakes().options).status()).toEqual({ installed: true, running: false, managed: true, installMethod: 'download' });
});

test('uninstall stops Ollama, then runs winget on Windows only', async () => {
  const run = async (platform, code, find = () => undefined, exists = () => false) => {
    const { spawned, options } = fakes(0);
    const ollama = createOllama({ ...options, platform, find, exists });
    const result = ollama.uninstall();
    // The app, then the server, are stopped one after the other; then the uninstaller runs.
    for (let step = 0; step < 3; step++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      spawned[step]?.proc.emit('exit', step === 2 ? code : 0);
    }
    return { result: await result, spawned };
  };
  const done = await run('win32', 0);
  expect(done.result).toBe('uninstalled');
  expect(done.spawned.map((item) => item.file)).toEqual(['taskkill', 'taskkill', 'winget']);
  expect(done.spawned[0].args).toEqual(['/IM', 'ollama app.exe', '/T', '/F']);
  expect(done.spawned[1].args).toEqual(['/IM', 'ollama.exe', '/T', '/F']);
  expect(done.spawned[2].args.slice(0, 3)).toEqual(['uninstall', '--id', 'Ollama.Ollama']);
  expect((await run('win32', 1, () => 'ollama.exe')).result).toBe('failed');
  expect((await run('win32', 1)).result).toBe('uninstalled');
  expect((await run('linux', 0)).spawned).toHaveLength(0);
  // Ollama's own uninstaller next to the CLI is preferred over winget.
  const own = await run('win32', 0, () => 'C:\\Ollama\\ollama.exe', () => true);
  expect(own.spawned[2].file).toMatch(/unins000\.exe$/);
  expect(own.spawned[2].args).toContain('/VERYSILENT');
  expect(own.result).toBe('uninstalled');
});

test('uninstall deletes the downloaded models through the server, then the default models folder', async () => {
  const calls = [];
  const removed = [];
  const spawned = [];
  const ollama = createOllama({
    env: { USERPROFILE: 'C:\\Users\\a' }, platform: 'win32', find: () => undefined, exists: () => false, settleMs: 1, pollMs: 1, attempts: 2,
    removeDir: (dir) => removed.push(dir),
    fetchImpl: async (url, options) => {
      calls.push(`${options?.method ?? 'GET'} ${new URL(url).pathname} ${options?.body ?? ''}`);
      return { ok: true, json: async () => ({ models: [{ name: 'qwen3:4b' }, { name: 'llama3.2:3b' }, {}] }) };
    },
    spawnProcess: (file) => { const proc = new EventEmitter(); spawned.push(file); setTimeout(() => proc.emit('exit', 0), 0); return proc; },
  });
  expect(await ollama.uninstall()).toBe('uninstalled');
  expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([
    'DELETE /api/delete {"model":"qwen3:4b"}', 'DELETE /api/delete {"model":"llama3.2:3b"}',
  ]);
  expect(removed).toEqual([join('C:\\Users\\a', '.ollama', 'models')]);

  // A models folder moved with OLLAMA_MODELS is left alone, and nothing is deleted if the uninstall failed.
  removed.length = 0;
  const custom = createOllama({ env: { OLLAMA_MODELS: 'D:\\models' }, platform: 'win32', find: () => undefined, exists: () => false, settleMs: 1, removeDir: (dir) => removed.push(dir), fetchImpl: async () => ({ ok: false }), spawnProcess: () => { const proc = new EventEmitter(); setTimeout(() => proc.emit('exit', 0), 0); return proc; } });
  expect(await custom.uninstall()).toBe('uninstalled');
  expect(removed).toEqual([]);
  const failed = createOllama({ env: {}, platform: 'win32', find: () => 'ollama.exe', exists: () => false, settleMs: 1, removeDir: (dir) => removed.push(dir), fetchImpl: async () => ({ ok: true, json: async () => ({ models: [] }) }), spawnProcess: () => { const proc = new EventEmitter(); setTimeout(() => proc.emit('exit', 1), 0); return proc; } });
  expect(await failed.uninstall()).toBe('failed');
  expect(removed).toEqual([]);
});

test('install runs winget on Windows only and reports the outcome', async () => {
  const outcome = async (platform, finish, find = () => undefined) => {
    const { spawned, options } = fakes();
    const ollama = createOllama({ ...options, platform, find });
    const result = ollama.install();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish?.(spawned[0]?.proc);
    return { result: await result, spawned };
  };
  const installed = await outcome('win32', (proc) => proc.emit('exit', 0));
  expect(installed.result).toBe('installed');
  expect(installed.spawned[0].file).toBe('winget');
  expect(installed.spawned[0].args.slice(0, 3)).toEqual(['install', '--id', 'Ollama.Ollama']);
  // The app window Ollama's installer opens is closed afterwards; nothing is closed when the install failed.
  expect(installed.spawned[1].file).toBe('taskkill');
  expect(installed.spawned[1].args).toEqual(['/IM', 'ollama app.exe', '/F']);
  const failed = await outcome('win32', (proc) => proc.emit('exit', 1));
  expect(failed.result).toBe('failed');
  expect(failed.spawned).toHaveLength(1);
  expect((await outcome('win32', (proc) => proc.emit('exit', 1), () => 'ollama.exe')).result).toBe('installed');
  expect((await outcome('win32', (proc) => proc.emit('error', Object.assign(new Error('spawn'), { code: 'ENOENT' })))).result).toBe('manual');
  const other = await outcome('darwin');
  expect(other.result).toBe('manual');
  expect(other.spawned).toHaveLength(0);
});
