import { afterAll, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { partFile } from './download.mjs';
import { createGpuQueue, whenGone } from './gpu-queue.mjs';
import { createLocal3d } from './local3d.mjs';
import { local3dVersion } from './local3d-models.mjs';
import { createSd } from './sd.mjs';
import { sdRelease } from './sd-models.mjs';

const id = (n) => `${n}`.repeat(8) + '-1111-1111-1111-111111111111';
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done) => { for (let i = 0; i < 400 && !done(); i++) await tick(5); expect(done()).toBe(true); };
const message = (promise) => promise.then((value) => value, (cause) => cause.message);
const dirs = [];
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'lomra-gpu-')); dirs.push(dir); return dir; };
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

/** A task that stays running until `finish` or `fail` is called. */
function held(log, name) {
  const task = { run: () => new Promise((resolve, reject) => {
    log.push(`${name} start`);
    task.finish = () => { log.push(`${name} end`); resolve(name); };
    task.fail = (cause) => { log.push(`${name} end`); reject(cause); };
  }) };
  return task;
}

test('runs start first in, first out, one at a time, and hear how many are ahead', async () => {
  const queue = createGpuQueue();
  const log = [];
  const [a, b, c] = ['a', 'b', 'c'].map((name) => held(log, name));
  const waits = { a: [], b: [], c: [] };
  const runs = [[a, 'a'], [b, 'b'], [c, 'c']].map(([task, name]) => queue.run(task.run, { onWait: (ahead) => waits[name].push(ahead) }));
  await tick();
  expect(log).toEqual(['a start']);
  expect(waits).toEqual({ a: [], b: [1], c: [2] });
  a.finish();
  await tick();
  expect(log).toEqual(['a start', 'a end', 'b start']);
  expect(waits).toEqual({ a: [], b: [1, 0], c: [2, 1] });
  b.finish();
  await tick();
  c.finish();
  expect(await Promise.all(runs)).toEqual(['a', 'b', 'c']);
  expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
  expect(waits.c).toEqual([2, 1, 0]);
});

test('a run cancelled while waiting rejects at once, never starts and moves the others up', async () => {
  const queue = createGpuQueue();
  const log = [];
  const [a, b, c] = ['a', 'b', 'c'].map((name) => held(log, name));
  const controller = new AbortController();
  const waits = [];
  const first = queue.run(a.run);
  const second = message(queue.run(b.run, { signal: controller.signal }));
  const third = queue.run(c.run, { onWait: (ahead) => waits.push(ahead) });
  controller.abort();
  expect(await second).toBe('Stopped.');
  expect(log).toEqual(['a start']);
  expect(waits).toEqual([2, 1]);
  a.finish();
  await first;
  await tick();
  c.finish();
  expect(await third).toBe('c');
  expect(log).toEqual(['a start', 'a end', 'c start', 'c end']);
  expect(await message(queue.run(b.run, { signal: controller.signal }))).toBe('Stopped.');
});

test('a failed run, a failed prepare and a throwing listener do not block the next run', async () => {
  const queue = createGpuQueue({ prepare: async () => { throw new Error('no Ollama'); } });
  const log = [];
  const a = held(log, 'a');
  const failed = message(queue.run(a.run));
  const thrown = message(queue.run(() => { throw new Error('sync'); }, { onWait: () => { throw new Error('window is gone'); } }));
  const last = queue.run(async () => 'done');
  await tick();
  a.fail(new Error('broken'));
  expect(await failed).toBe('broken');
  expect(await thrown).toBe('sync');
  expect(await last).toBe('done');
});

test('prepare runs before every turn, not while another run is going, and a run cancelled during it never starts', async () => {
  const log = [];
  let release;
  const queue = createGpuQueue({ prepare: (signal) => { log.push('prepare'); return signal ? new Promise((resolve) => { release = resolve; signal.addEventListener('abort', resolve); }) : undefined; } });
  const a = held(log, 'a');
  const b = held(log, 'b');
  const first = queue.run(a.run);
  const controller = new AbortController();
  const second = message(queue.run(b.run, { signal: controller.signal }));
  const third = queue.run(async () => { log.push('c start'); });
  await tick();
  expect(log).toEqual(['prepare', 'a start']);
  a.finish();
  await first;
  await until(() => !!release);
  controller.abort();
  expect(await second).toBe('Stopped.');
  await third;
  expect(log).toEqual(['prepare', 'a start', 'a end', 'prepare', 'prepare', 'c start']);
});

test('whenGone waits for the process, even when a kill failed, and rejects only if it never started', async () => {
  const proc = Object.assign(new EventEmitter(), { pid: 1 });
  let gone = false;
  const wait = whenGone(proc).then((code) => { gone = true; return code; });
  proc.emit('error', new Error('kill EPERM'));
  await tick();
  expect(gone).toBe(false);
  proc.emit('exit', 3);
  expect(await wait).toBe(3);

  // The pipes of a launcher stay open while the process behind it lives.
  const launcher = Object.assign(new EventEmitter(), { pid: 1, stdout: { closed: false } });
  gone = false;
  const behind = whenGone(launcher).then(() => { gone = true; });
  launcher.emit('exit', null);
  await tick();
  expect(gone).toBe(false);
  launcher.emit('close', null);
  await behind;

  // A pipe that never closes does not hold the graphics card for ever.
  const stuck = Object.assign(new EventEmitter(), { pid: 1, stdout: { closed: false } });
  const bounded = whenGone(stuck, 10);
  stuck.emit('exit', 0);
  expect(await bounded).toBe(0);

  const missing = spawn(join(tempDir(), 'missing.exe'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  await expect(whenGone(missing)).rejects.toThrow();
});

/** sd and local3d on one queue, with engines that look installed; `spawnProcess` stands in for both. */
function engines(gpuQueue, spawnProcess, sdOptions = {}) {
  const sdDir = tempDir();
  const threeDir = tempDir();
  const file = (path) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'x'); };
  file(join(sdDir, 'engine', sdRelease, 'sd-cli.exe'));
  file(join(sdDir, 'models', 'tiny.safetensors'));
  file(join(threeDir, 'venv', 'Scripts', 'python.exe'));
  file(join(threeDir, 'models', 'tiny', 'model.bin'));
  writeFileSync(join(threeDir, 'packages.json'), JSON.stringify({ version: local3dVersion }));
  const options = { platform: 'win32', arch: 'x64', env: {}, spawnProcess, ...(gpuQueue ? { gpuQueue } : {}) };
  return {
    sdDir, sdOut: () => existsSync(join(sdDir, 'out')) ? readdirSync(join(sdDir, 'out')) : [],
    sd: createSd({ ...options, dir: sdDir, models: [{ id: 'tiny', name: 'Tiny', size: 512, steps: 4, cfg: 1 }, two], engines: { 'win32-x64': { bytes: 1 } }, ...sdOptions }),
    local3d: createLocal3d({ ...options, dir: threeDir, downloads: [], models: [{ id: 'tiny', name: 'Tiny', kind: 'triposr', folder: 'tiny', needs: 1, weights: [{ path: 'tiny/model.bin', bytes: 1 }] }] }),
  };
}
const two = { id: 'two', name: 'Two', repo: 'a/two', file: 'two.safetensors', sha256: 'a'.repeat(64), bytes: 9, size: 512, steps: 4, cfg: 1 };
const picture = { model: 'tiny', prompt: 'a fox' };
const pngBytes = Buffer.alloc(40);
Buffer.from('89504e470d0a1a0a0000000d494844520000004000000040', 'hex').copy(pngBytes);
const png = `data:image/png;base64,${pngBytes.toString('base64')}`;
const photo = { model: 'tiny', image: `data:image/png;base64,${Buffer.from('png').toString('base64')}` };

/** Processes the test ends by hand. `kill` only asks, like a real one: the exit comes later. */
function fakeEngine() {
  const procs = [];
  const spawnProcess = (command, args) => {
    const proc = Object.assign(new EventEmitter(), { pid: procs.length + 1, stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false, kill() { proc.killed = true; } });
    proc.exit = (code) => {
      if (code === 0) writeFileSync(command.endsWith('python.exe') ? args[5] : args[args.indexOf('-o') + 1], 'result');
      proc.gone = true;
      proc.emit('exit', code);
    };
    proc.what = command.endsWith('python.exe') ? '3d' : 'sd';
    // The whole point: nothing else is alive when a run starts.
    if (procs.some((item) => !item.gone)) proc.overlap = true;
    procs.push(proc);
    return proc;
  };
  return { procs, spawnProcess };
}

test('local pictures and local 3D never overlap through one queue, and each run hears only its own progress', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, local3d } = engines(createGpuQueue(), spawnProcess);
  const events = { a: [], b: [], c: [] };
  const a = sd.generate(id(1), picture, (event) => events.a.push(event));
  const b = local3d.generate(id(2), photo, (event) => events.b.push(event));
  const c = sd.generate(id(3), picture, (event) => events.c.push(event));
  await until(() => procs.length === 1);
  await tick();
  expect(procs.map((proc) => proc.what)).toEqual(['sd']);
  procs[0].stderr.emit('data', '| 2/4 - 0.50s/it');
  procs[0].exit(0);
  expect((await a).image).toStartWith('data:image/png');
  await until(() => procs.length === 2);
  procs[1].stdout.emit('data', '{"stage":"shape"}\n');
  await tick();
  expect(procs.map((proc) => proc.what)).toEqual(['sd', '3d']);
  procs[1].exit(0);
  expect(await b).toStartWith('data:model/gltf-binary');
  await until(() => procs.length === 3);
  procs[2].exit(0);
  await c;
  expect(procs.some((proc) => proc.overlap)).toBe(false);
  expect(events).toEqual({
    a: [{ step: 2, total: 4 }],
    b: [{ stage: 'waiting', waiting: 1 }, { stage: 'waiting', waiting: 0 }, { stage: 'shape' }],
    c: [{ step: 0, total: 4, waiting: 2 }, { step: 0, total: 4, waiting: 1 }, { step: 0, total: 4, waiting: 0 }],
  });
});

test('cancelling a running picture starts the waiting 3D run only after its process has exited', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, local3d } = engines(createGpuQueue(), spawnProcess);
  const a = message(sd.generate(id(1), picture));
  const waiting = message(local3d.generate(id(2), photo));
  const b = local3d.generate(id(3), photo);
  await until(() => procs.length === 1);
  local3d.cancel(id(2));
  expect(await waiting).toBe('Stopped.');
  // The cancelled id is free again, and its run never reached the card.
  sd.cancel(id(1));
  await tick(30);
  expect(procs).toHaveLength(1);
  expect(procs[0].killed).toBe(true);
  procs[0].exit(null);
  expect(await a).toBe('Stopped.');
  await until(() => procs.length === 2);
  procs[1].exit(0);
  expect(await b).toStartWith('data:model');
  expect(procs.some((proc) => proc.overlap)).toBe(false);
});

test('a failed run of one engine leaves the other engine’s run alone', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, local3d } = engines(createGpuQueue(), spawnProcess);
  const a = message(local3d.generate(id(1), photo));
  const b = sd.generate(id(2), picture);
  await until(() => procs.length === 1);
  procs[0].exit(1);
  expect(await a).toContain('could not be made');
  await until(() => procs.length === 2);
  procs[1].exit(0);
  expect((await b).image).toStartWith('data:image/png');
});

test('stop ends the running and the waiting runs of both engines', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, local3d } = engines(createGpuQueue(), spawnProcess);
  const runs = [message(sd.generate(id(1), picture)), message(local3d.generate(id(2), photo)), message(sd.generate(id(3), picture))];
  await until(() => procs.length === 1);
  sd.stop();
  local3d.stop();
  expect(await Promise.all(runs.slice(1))).toEqual(['Stopped.', 'Stopped.']);
  expect(procs[0].killed).toBe(true);
  procs[0].exit(null);
  expect(await runs[0]).toBe('Stopped.');
  await tick(30);
  expect(procs).toHaveLength(1);
});

test('real processes: a killed run is gone before the next one starts', async () => {
  const pids = [];
  const overlaps = [];
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const spawnProcess = (_command, args) => {
    overlaps.push(pids.filter(alive).length);
    // The first one runs until it is killed; the others write their result and end.
    const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : args[5];
    const code = pids.length ? `require('fs').writeFileSync(process.argv[1], 'result')` : 'setInterval(() => {}, 1000)';
    const proc = spawn(process.execPath, ['-e', code, out], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    pids.push(proc.pid);
    return proc;
  };
  const { sd, local3d } = engines(createGpuQueue(), spawnProcess);
  const a = message(sd.generate(id(1), picture));
  const b = message(local3d.generate(id(2), photo));
  const c = message(sd.generate(id(3), picture));
  await until(() => pids.length === 1);
  await tick(100);
  expect(alive(pids[0])).toBe(true);
  sd.cancel(id(1));
  expect(await a).toBe('Stopped.');
  expect(await b).toStartWith('data:model');
  expect((await c).image).toStartWith('data:image');
  expect(overlaps).toEqual([0, 0, 0]);
}, 20_000);

test('a picture is checked before it queues, waits with its own step count, and only the run whose turn it is has files', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, local3d, sdOut } = engines(createGpuQueue(), spawnProcess);
  const events = [];
  const first = local3d.generate(id(1), photo);
  await until(() => procs.length === 1);
  for (const bad of [{ steps: 51 }, { image: 'C:/secret.png' }, { mask: png }, { image: png, strength: 2 }, { model: 'nope' }]) await expect(sd.generate(id(2), { ...picture, ...bad }, (event) => events.push(event))).rejects.toThrow();
  expect(events).toEqual([]);
  const edit = sd.generate(id(2), { ...picture, image: png, mask: png, steps: 9, strength: 0.5 }, (event) => events.push(event));
  const last = sd.generate(id(3), { ...picture, image: png }, () => {});
  await tick();
  expect(events).toEqual([{ step: 0, total: 9, waiting: 1 }]);
  expect(sdOut()).toEqual([]);
  procs[0].exit(0);
  await first;
  await until(() => procs.length === 2);
  expect(events).toEqual([{ step: 0, total: 9, waiting: 1 }, { step: 0, total: 9, waiting: 0 }]);
  expect(sdOut()).toEqual([id(2)]);
  procs[1].exit(0);
  expect((await edit).settings).toMatchObject({ steps: 9, strength: 0.5, image: true, mask: true });
  await until(() => procs.length === 3);
  expect(sdOut()).toEqual([id(3)]);
  procs[2].exit(0);
  await last;
  expect(sdOut()).toEqual([]);
});

test('a waiting picture that is cancelled leaves no files, and the next one clears the folder only once a cancelled engine is gone', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, sdDir, sdOut } = engines(createGpuQueue(), spawnProcess);
  const a = message(sd.generate(id(1), { ...picture, image: png }));
  await until(() => procs.length === 1);
  const waiting = message(sd.generate(id(2), { ...picture, image: png, mask: png }));
  const c = sd.generate(id(3), { ...picture, image: png });
  sd.cancel(id(2));
  expect(await waiting).toBe('Stopped.');
  expect(sdOut()).toEqual([id(1)]);
  sd.cancel(id(1));
  expect(procs[0].killed).toBe(true);
  // Still alive: what it writes now must not meet the next run.
  mkdirSync(join(sdDir, 'out', id(1)), { recursive: true });
  writeFileSync(join(sdDir, 'out', id(1), 'out.png'), 'late');
  await tick(30);
  expect(procs).toHaveLength(1);
  expect(sdOut()).toEqual([id(1)]);
  procs[0].exit(null);
  expect(await a).toBe('Stopped.');
  await until(() => procs.length === 2);
  expect(sdOut()).toEqual([id(3)]);
  expect(existsSync(join(sdDir, 'out', id(3), 'init.png'))).toBe(true);
  procs[1].exit(0);
  await c;
  expect(sdOut()).toEqual([]);
  expect(procs.some((proc) => proc.overlap)).toBe(false);
});

test('models and engines stay while a run is running or waiting, and a half-downloaded model cannot run', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const { sd, local3d, sdDir } = engines(createGpuQueue(), spawnProcess);
  const part = partFile(join(sdDir, 'models', 'two.safetensors'), two.sha256);
  writeFileSync(part, 'half');
  const running = local3d.generate(id(1), photo);
  await until(() => procs.length === 1);
  const waiting = message(sd.generate(id(2), picture));
  await expect(sd.generate(id(3), { ...picture, model: 'two' })).rejects.toThrow('Download this model in Settings → Local models first.');
  expect(sd.remove('tiny')).toBe(false);
  expect(local3d.remove('tiny')).toBe(false);
  // An unfinished download is not in use, but the engine is.
  expect(sd.remove('two')).toBe(true);
  expect(existsSync(part)).toBe(false);
  expect(sd.status()).toMatchObject({ engine: true, models: [{ id: 'tiny', installed: true }, { id: 'two', partial: 0 }] });
  sd.cancel(id(2));
  expect(await waiting).toBe('Stopped.');
  procs[0].exit(0);
  await running;
  writeFileSync(part, 'half');
  expect(sd.remove('tiny')).toBe(true);
  expect(sd.status().engine).toBe(true);
  expect(sd.remove('two')).toBe(true);
  expect(sd.status().engine).toBe(false);
  expect(local3d.remove('tiny')).toBe(true);
});

test('stop on quit ends the download, the running picture and the waiting one, and starts nothing', async () => {
  const { procs, spawnProcess } = fakeEngine();
  const asked = [];
  // Sends a first piece, then nothing until it is aborted.
  const fetchImpl = async (url, { signal }) => {
    asked.push(url);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); signal.addEventListener('abort', () => controller.error(new Error('aborted'))); } }));
  };
  const { sd, sdDir, sdOut } = engines(createGpuQueue(), spawnProcess, { fetchImpl });
  sd.download('two');
  await until(() => sd.status().downloading?.received === 4);
  const runs = [message(sd.generate(id(1), { ...picture, image: png })), message(sd.generate(id(2), { ...picture, image: png }))];
  await until(() => procs.length === 1);
  sd.stop();
  expect(procs[0].killed).toBe(true);
  // The app is gone before the engine is, so its pictures go now.
  expect(sdOut()).toEqual([]);
  procs[0].exit(null);
  expect(await Promise.all(runs)).toEqual(['Stopped.', 'Stopped.']);
  await until(() => !sd.status().downloading);
  expect([procs.length, asked.length, sdOut()]).toEqual([1, 1, []]);
  expect(existsSync(partFile(join(sdDir, 'models', 'two.safetensors'), two.sha256))).toBe(true);
});
