import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, createUpdates, isReleaseUrl, parseSha256Digest } from './updates.mjs';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

function streamFromChunks(chunks, { onCancel, delayMs = 0 } = {}) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]);
    },
    cancel() {
      onCancel?.();
    },
  });
}

test('compareVersions compares semver-ish versions and strips leading v', () => {
  expect(compareVersions('v0.0.3', '0.0.3')).toBe(0);
  expect(compareVersions('v0.0.4', '0.0.3')).toBe(1);
  expect(compareVersions('0.0.3', 'v0.0.4')).toBe(-1);
  expect(compareVersions('0.1.0', '0.0.10')).toBe(1);
  expect(compareVersions('1.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
  expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
});

test('parseSha256Digest parses valid sha256 digests and rejects invalid ones', () => {
  const hex = '436a0c23170a39f042a60f7c6cb61da2b3ed069460e6449f9298837e45e7cd8d';
  expect(parseSha256Digest(`sha256:${hex}`)).toBe(hex);
  expect(parseSha256Digest(`SHA256:${hex.toUpperCase()}`)).toBe(hex);
  expect(parseSha256Digest(`sha512:${hex}`)).toBeUndefined();
  expect(parseSha256Digest('sha256:short')).toBeUndefined();
  expect(parseSha256Digest(undefined)).toBeUndefined();
});

test('isReleaseUrl allows only GitHub release URLs for the Lomra repo', () => {
  expect(isReleaseUrl('https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3')).toBe(true);
  expect(isReleaseUrl('https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe')).toBe(true);
  expect(isReleaseUrl('https://github.com/Nxdus/lomra-app/releases/')).toBe(false);
  expect(isReleaseUrl('http://github.com/Nxdus/lomra-app/releases/tag/v0.0.3')).toBe(false);
  expect(isReleaseUrl('https://github.com/other/repo/releases/tag/v0.0.3')).toBe(false);
  expect(isReleaseUrl('https://evil.example/Nxdus/lomra-app/releases/tag/v0.0.3')).toBe(false);
  expect(isReleaseUrl('https://user@github.com/Nxdus/lomra-app/releases/tag/v0.0.3')).toBe(false);
  expect(isReleaseUrl('https://github.com/Nxdus/lomra-app/releases/../issues/1')).toBe(false);
  expect(isReleaseUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
  expect(isReleaseUrl(null)).toBe(false);
});

test('createUpdates picks platform/arch asset, digest, size, trims notes, and caches for 1 hour', async () => {
  let calls = 0;
  let time = 1000;
  const digestHex = 'a'.repeat(64);
  const fakeFetch = async (url, options) => {
    calls++;
    expect(url).toBe('https://api.github.com/repos/Nxdus/lomra-app/releases/latest');
    expect(options.headers.Accept).toBe('application/vnd.github+json');
    expect(options.headers['User-Agent']).toBe('Lomra');
    return {
      ok: true,
      json: async () => ({
        tag_name: 'v0.0.4',
        html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.4',
        body: '  Added version check\n- Bug fixes  ',
        published_at: '2026-11-20T00:00:00Z',
        draft: false,
        prerelease: false,
        assets: [
          {
            name: 'Lomra-0.0.4-mac-arm64.dmg',
            size: 123,
            digest: `sha256:${'b'.repeat(64)}`,
            browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.4/Lomra-0.0.4-mac-arm64.dmg',
          },
          {
            name: 'Lomra-0.0.4-windows-x64.exe',
            size: 456,
            digest: `sha256:${digestHex}`,
            browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.4/Lomra-0.0.4-windows-x64.exe',
          },
        ],
      }),
    };
  };

  const updates = createUpdates({
    currentVersion: '0.0.3',
    fetch: fakeFetch,
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    now: () => time,
  });

  const first = await updates.check();
  expect(first).toEqual({
    current: '0.0.3',
    latest: '0.0.4',
    available: true,
    url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.4',
    notes: 'Added version check\n- Bug fixes',
    publishedAt: '2026-11-20T00:00:00Z',
    assetUrl: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.4/Lomra-0.0.4-windows-x64.exe',
    assetName: 'Lomra-0.0.4-windows-x64.exe',
    assetSize: 456,
    assetSha256: digestHex,
    canInstall: true,
  });
  expect(calls).toBe(1);

  time += 30 * 60 * 1000;
  await updates.check();
  expect(calls).toBe(1);

  await updates.check(true);
  expect(calls).toBe(2);

  time += 61 * 60 * 1000;
  await updates.check();
  expect(calls).toBe(3);
});

test('createUpdates returns undefined asset fields and canInstall false when no matching platform asset exists', async () => {
  const updates = createUpdates({
    currentVersion: '0.0.3',
    platform: 'linux',
    arch: 'x64',
    isPackaged: true,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v0.0.3',
        html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
        body: '',
        assets: [
          {
            name: 'Lomra-0.0.3-windows-x64.exe',
            size: 100,
            digest: `sha256:${'a'.repeat(64)}`,
            browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
          },
        ],
      }),
    }),
  });

  const result = await updates.check();
  expect(result.available).toBe(false);
  expect(result.assetUrl).toBeUndefined();
  expect(result.assetName).toBeUndefined();
  expect(result.assetSize).toBeUndefined();
  expect(result.assetSha256).toBeUndefined();
  expect(result.canInstall).toBe(false);
});

test('createUpdates skips draft and prerelease releases', async () => {
  for (const flags of [{ draft: true, prerelease: false }, { draft: false, prerelease: true }]) {
    const updates = createUpdates({
      currentVersion: '0.0.3',
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v0.0.5',
          html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.5',
          ...flags,
        }),
      }),
    });
    const result = await updates.check();
    expect(result).toEqual({ current: '0.0.3', available: false, canInstall: false });
  }
});

test('createUpdates returns error info instead of throwing on HTTP or network errors', async () => {
  const httpFail = createUpdates({
    currentVersion: '0.0.3',
    fetch: async () => ({ ok: false, status: 403 }),
  });
  expect(await httpFail.check()).toEqual({ current: '0.0.3', error: 'GitHub returned HTTP 403' });

  const netFail = createUpdates({
    currentVersion: '0.0.3',
    fetch: async () => { throw new Error('Network offline'); },
  });
  expect(await netFail.check()).toEqual({ current: '0.0.3', error: 'Network offline' });
});

test('install refuses when not available, missing digest, or non-win32', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-upd-refuse-'));
  try {
    const noCheck = createUpdates({ currentVersion: '0.0.3', platform: 'win32', arch: 'x64' });
    expect(await noCheck.install({ dir })).toEqual({ ok: false, error: 'No update is available.' });

    const notAvailable = createUpdates({
      currentVersion: '0.0.3',
      platform: 'win32',
      arch: 'x64',
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v0.0.3',
          html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
          assets: [{
            name: 'Lomra-0.0.3-windows-x64.exe',
            size: 4,
            digest: `sha256:${sha256Hex(Buffer.from('test'))}`,
            browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
          }],
        }),
      }),
    });
    await notAvailable.check();
    expect(await notAvailable.install({ dir })).toEqual({ ok: false, error: 'No update is available.' });

    const noDigest = createUpdates({
      currentVersion: '0.0.1',
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v0.0.3',
          html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
          assets: [{
            name: 'Lomra-0.0.3-windows-x64.exe',
            size: 4,
            browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
          }],
        }),
      }),
    });
    const noDigestInfo = await noDigest.check();
    expect(noDigestInfo.canInstall).toBe(false);
    expect(await noDigest.install({ dir })).toEqual({ ok: false, error: 'Release is missing a SHA-256 digest.' });

    const nonWin = createUpdates({
      currentVersion: '0.0.1',
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: true,
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v0.0.3',
          html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
          assets: [{
            name: 'Lomra-0.0.3-mac-arm64.dmg',
            size: 4,
            digest: `sha256:${sha256Hex(Buffer.from('test'))}`,
            browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-mac-arm64.dmg',
          }],
        }),
      }),
    });
    const nonWinInfo = await nonWin.check();
    expect(nonWinInfo.canInstall).toBe(false);
    expect(await nonWin.install({ dir })).toEqual({ ok: false, error: 'In-app updates are only supported on Windows.' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install verifies SHA-256 and size, reports progress, returns verified path, and launch spawns NSIS silently', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-upd-ok-'));
  try {
    const payload = Buffer.from('MZ-fake-installer-binary-content');
    const digest = sha256Hex(payload);
    const spawned = [];
    let unreffed = false;
    let time = 1000;

    const updates = createUpdates({
      currentVersion: '0.0.1',
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      now: () => time,
      fetch: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return {
            ok: true,
            json: async () => ({
              tag_name: 'v0.0.3',
              html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
              assets: [{
                name: 'Lomra-0.0.3-windows-x64.exe',
                size: payload.byteLength,
                digest: `sha256:${digest}`,
                browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
              }],
            }),
          };
        }
        return {
          ok: true,
          headers: new Headers({ 'content-length': String(payload.byteLength) }),
          body: streamFromChunks([payload.subarray(0, 10), payload.subarray(10)]),
        };
      },
      spawn: (command, args, options) => {
        spawned.push({ command, args, options });
        return { unref() { unreffed = true; } };
      },
    });

    await updates.check();
    const progressEvents = [];
    const result = await updates.install({
      dir,
      onProgress: (event) => {
        progressEvents.push(event);
        time += 300;
      },
    });

    const expectedPath = join(dir, 'Lomra-0.0.3-windows-x64.exe');
    expect(result).toEqual({ ok: true, path: expectedPath });
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(`${expectedPath}.part`)).toBe(false);
    expect(readFileSync(expectedPath)).toEqual(payload);
    expect(progressEvents[0]).toEqual({ received: 0, total: payload.byteLength });
    expect(progressEvents.at(-1)).toEqual({ received: payload.byteLength, total: payload.byteLength });

    updates.launch(result.path);
    expect(spawned).toEqual([{
      command: expectedPath,
      args: ['/S', '--updated', '--force-run'],
      options: { detached: true, stdio: 'ignore', windowsHide: true },
    }]);
    expect(unreffed).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install deletes partial file and fails on hash mismatch or size mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-upd-bad-'));
  try {
    const payload = Buffer.from('corrupted-installer');
    const wrongHash = '0'.repeat(64);

    const badHashUpdates = createUpdates({
      currentVersion: '0.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return {
            ok: true,
            json: async () => ({
              tag_name: 'v0.0.3',
              html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
              assets: [{
                name: 'Lomra-0.0.3-windows-x64.exe',
                size: payload.byteLength,
                digest: `sha256:${wrongHash}`,
                browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
              }],
            }),
          };
        }
        return { ok: true, body: streamFromChunks([payload]) };
      },
    });
    await badHashUpdates.check();
    const hashRes = await badHashUpdates.install({ dir });
    expect(hashRes.ok).toBe(false);
    expect(hashRes.error).toContain('SHA-256');
    expect(readdirSync(dir)).toEqual([]);

    const badSizeUpdates = createUpdates({
      currentVersion: '0.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return {
            ok: true,
            json: async () => ({
              tag_name: 'v0.0.3',
              html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
              assets: [{
                name: 'Lomra-0.0.3-windows-x64.exe',
                size: payload.byteLength + 50,
                digest: `sha256:${sha256Hex(payload)}`,
                browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
              }],
            }),
          };
        }
        return { ok: true, body: streamFromChunks([payload]) };
      },
    });
    await badSizeUpdates.check();
    const sizeRes = await badSizeUpdates.install({ dir });
    expect(sizeRes.ok).toBe(false);
    expect(sizeRes.error).toContain('size');
    expect(readdirSync(dir)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install cleans up .part file on cancel and blocks concurrent installs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-upd-cancel-'));
  try {
    const chunk = Buffer.from('partial-bytes');
    const controller = new AbortController();
    const updates = createUpdates({
      currentVersion: '0.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return {
            ok: true,
            json: async () => ({
              tag_name: 'v0.0.3',
              html_url: 'https://github.com/Nxdus/lomra-app/releases/tag/v0.0.3',
              assets: [{
                name: 'Lomra-0.0.3-windows-x64.exe',
                size: chunk.byteLength * 2,
                digest: `sha256:${sha256Hex(chunk)}`,
                browser_download_url: 'https://github.com/Nxdus/lomra-app/releases/download/v0.0.3/Lomra-0.0.3-windows-x64.exe',
              }],
            }),
          };
        }
        return { ok: true, body: streamFromChunks([chunk, chunk], { delayMs: 40 }) };
      },
    });
    await updates.check();

    const first = updates.install({ dir, signal: controller.signal });
    const concurrent = await updates.install({ dir });
    expect(concurrent).toEqual({ ok: false, error: 'An update is already downloading.' });

    setTimeout(() => controller.abort(), 15);
    const canceled = await first;
    expect(canceled).toEqual({ ok: false, error: 'Update canceled.' });
    expect(readdirSync(dir)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
