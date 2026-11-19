import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createFfmpeg } from './ffmpeg.mjs';
import { buildStitchArgs, ffmpegBuilds, parseProbe, videoSize } from './ffmpeg-models.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const runId = '11111111-1111-1111-1111-111111111111';
const wait = async (until) => { for (let i = 0; i < 200 && !until(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); };
const body = 'ffmpeg-zip';
const builds = { 'win32-x64': { asset: 'ffmpeg.zip', sha256: sha(body), bytes: body.length } };
const fetchImpl = async () => new Response(Readable.toWeb(Readable.from([Buffer.from(body)])), { status: 200 });
// Mimics the archive layout: one folder holding bin/ffmpeg.exe.
const fakeExtract = async (_zip, dest) => {
  mkdirSync(join(dest, 'build', 'bin'), { recursive: true });
  writeFileSync(join(dest, 'build', 'bin', 'ffmpeg.exe'), 'binary');
  writeFileSync(join(dest, 'build', 'LICENSE.txt'), 'license');
};

function make(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-ffmpeg-'));
  return { dir, ffmpeg: createFfmpeg({ dir, platform: 'win32', arch: 'x64', env: { LOMRA_SECRET: 'x', PATH: '/bin' }, builds, fetchImpl, extract: fakeExtract, ...overrides }) };
}

test('the pinned builds carry a hash and a size', () => {
  for (const build of Object.values(ffmpegBuilds)) {
    expect(build.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(build.bytes).toBeGreaterThan(0);
  }
});

test('parseProbe reads the length and whether there is sound', () => {
  const withSound = '  Duration: 00:00:05.04, start: 0.000000\n  Stream #0:0[0x1](und): Video: h264\n  Stream #0:1[0x2](und): Audio: aac (LC)';
  expect(parseProbe(withSound)).toEqual({ audio: true, seconds: 5.04 });
  expect(parseProbe('  Duration: 01:02:03.50, start: 0\n  Stream #0:0: Video: vp9')).toEqual({ audio: false, seconds: 3723.5 });
  expect(parseProbe('not a video')).toEqual({ audio: false, seconds: 0 });
});

test('videoSize falls back to 16:9', () => {
  expect(videoSize('9:16')).toMatchObject({ width: 720, height: 1280 });
  expect(videoSize('nonsense')).toMatchObject({ width: 1280, height: 720 });
});

test('buildStitchArgs cuts or holds every clip to its length and adds silence only where there is none', () => {
  const args = buildStitchArgs([{ file: 'a.bin', seconds: 2, audio: true }, { file: 'b.bin', seconds: 4.5, audio: false }], videoSize('16:9'), 'out.mp4');
  expect(args.slice(0, 7)).toEqual(['-hide_banner', '-nostdin', '-y', '-i', 'a.bin', '-i', 'b.bin']);
  const graph = args[args.indexOf('-filter_complex') + 1];
  expect(graph).toContain('[0:v:0]fps=24,scale=1280:720');
  expect(graph).toContain('tpad=stop_mode=clone:stop_duration=4.500,trim=duration=4.500');
  expect(graph).toContain('[0:a:0]aresample=48000');
  expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=4.500');
  expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]');
  expect(args.at(-1)).toBe('out.mp4');
});

test('an unsupported computer cannot download', () => {
  const { ffmpeg } = make({ platform: 'freebsd' });
  expect(ffmpeg.status().supported).toBe(false);
  expect(ffmpeg.download()).toBe(false);
});

test('download verifies the archive, keeps only the program and reports it installed', async () => {
  const { ffmpeg, dir } = make();
  expect(ffmpeg.status()).toMatchObject({ supported: true, installed: false });
  expect(ffmpeg.download()).toBe(true);
  expect(ffmpeg.download()).toBe(false);
  await wait(() => !ffmpeg.status().downloading);
  expect(ffmpeg.status()).toMatchObject({ installed: true, error: null });
  expect(ffmpeg.download()).toBe(false);
  expect(ffmpeg.remove()).toBe(true);
  expect(ffmpeg.status().installed).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('a corrupted download installs nothing and says so', async () => {
  const { ffmpeg, dir } = make({ builds: { 'win32-x64': { ...builds['win32-x64'], sha256: sha('other') } } });
  ffmpeg.download();
  await wait(() => !ffmpeg.status().downloading);
  expect(ffmpeg.status()).toMatchObject({ installed: false, error: 'The download was corrupted. Try again.' });
  expect(existsSync(join(dir, 'engine', 'ffmpeg.zip.part'))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

async function installed(overrides) {
  const made = make(overrides);
  made.ffmpeg.download();
  await wait(() => !made.ffmpeg.status().downloading);
  return made;
}

test('stitch rejects invalid input before running anything', async () => {
  const { ffmpeg, dir } = await installed();
  const clip = { data: new Uint8Array([1, 2, 3]), seconds: 2 };
  await expect(ffmpeg.stitch('bad', { clips: [clip] })).rejects.toThrow('Invalid video run.');
  await expect(ffmpeg.stitch(runId, { clips: [] })).rejects.toThrow('Join between');
  await expect(ffmpeg.stitch(runId, { clips: Array(13).fill(clip) })).rejects.toThrow('Join between');
  await expect(ffmpeg.stitch(runId, { clips: [{ ...clip, seconds: 0 }] })).rejects.toThrow('1 to 60 seconds');
  await expect(ffmpeg.stitch(runId, { clips: [{ data: new Uint8Array(0), seconds: 2 }] })).rejects.toThrow('missing or larger');
  await expect(ffmpeg.stitch(runId, { clips: [{ data: 'path/to/file', seconds: 2 }] })).rejects.toThrow('missing or larger');
  await expect(ffmpeg.stitch(runId, { clips: [clip], aspectRatio: 5 })).rejects.toThrow('Invalid aspect ratio.');
  rmSync(dir, { recursive: true, force: true });
});

test('stitch needs the tool downloaded first', async () => {
  const { ffmpeg, dir } = make();
  await expect(ffmpeg.stitch(runId, { clips: [{ data: new Uint8Array([1]), seconds: 2 }] })).rejects.toThrow('Download the video tool first.');
  rmSync(dir, { recursive: true, force: true });
});

test('stitch probes each clip, runs ffmpeg without the secret and returns the video', async () => {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const handlers = {};
    const stderr = { on: (_event, callback) => { handlers.stderr = callback; } };
    const proc = { stderr, kill() {}, on: (event, callback) => { handlers[event] = callback; } };
    queueMicrotask(() => {
      if (args.includes('-filter_complex')) {
        writeFileSync(args.at(-1), 'mp4-bytes');
        handlers.stderr?.('frame=1 time=00:00:03.00 speed=2x');
      } else handlers.stderr?.('  Duration: 00:00:05.00, start: 0\n  Stream #0:0: Video: h264\n  Stream #0:1: Audio: aac');
      handlers.exit?.(0);
    });
    return proc;
  };
  const { ffmpeg, dir } = make({ spawnProcess });
  ffmpeg.download();
  await wait(() => !ffmpeg.status().downloading);
  const progress = [];
  const video = await ffmpeg.stitch(runId, { clips: [{ data: new Uint8Array([1]), seconds: 4 }, { data: new ArrayBuffer(2), seconds: 6 }], aspectRatio: '9:16' }, (event) => progress.push(event));
  expect(Buffer.from(video).toString()).toBe('mp4-bytes');
  expect(calls).toHaveLength(3);
  expect(calls[2].options.env.LOMRA_SECRET).toBeUndefined();
  expect(calls[2].args.join(' ')).toContain('scale=720:1280');
  expect(progress).toEqual([{ seconds: 3, total: 10 }]);
  rmSync(dir, { recursive: true, force: true });
});
