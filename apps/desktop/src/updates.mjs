import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DEFAULT_REPO = 'Nxdus/lomra-app';
const CACHE_TTL_MS = 60 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 250;

function normalizeVersion(version) {
  return String(version ?? '').trim().replace(/^v/i, '');
}

function parseVersion(version) {
  const clean = normalizeVersion(version).split('+')[0];
  const dash = clean.indexOf('-');
  const core = dash === -1 ? clean : clean.slice(0, dash);
  const pre = dash === -1 ? '' : clean.slice(dash + 1);
  const parts = core.split('.').map((part) => {
    const num = Number.parseInt(part, 10);
    return Number.isFinite(num) && String(num) === part ? num : 0;
  });
  return { parts, pre };
}

/** Semver-ish comparison returning -1, 0, or 1; strips leading `v` and gives stable > prerelease. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.parts.length, right.parts.length);
  for (let i = 0; i < length; i++) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** Allow only GitHub release/download pages for the configured Lomra repository. */
export function isReleaseUrl(url, repo = DEFAULT_REPO) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return false;
    if (parsed.username || parsed.password) return false;
    const prefix = `/${repo}/releases/`;
    return parsed.pathname.startsWith(prefix) && parsed.pathname.length > prefix.length;
  } catch {
    return false;
  }
}

/** Parse a GitHub release asset `digest` (`sha256:<64 hex>`) into lowercase hex, or undefined if missing/invalid. */
export function parseSha256Digest(digest) {
  if (typeof digest !== 'string') return undefined;
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest.trim());
  return match ? match[1].toLowerCase() : undefined;
}

const PLATFORM_NAMES = {
  win32: { os: ['windows', 'win'], ext: '.exe' },
  darwin: { os: ['mac', 'darwin', 'osx'], ext: '.dmg' },
  linux: { os: ['linux'], ext: '.appimage' },
};

const ARCH_ALIASES = {
  x64: ['x64', 'amd64', 'x86_64'],
  arm64: ['arm64', 'aarch64'],
  ia32: ['ia32', 'x86', '386'],
};

const ALL_ARCH_TOKENS = Object.values(ARCH_ALIASES).flat();

function pickAsset(assets, { platform, arch, repo }) {
  if (!Array.isArray(assets)) return undefined;
  const target = PLATFORM_NAMES[platform];
  if (!target) return undefined;
  const arches = ARCH_ALIASES[arch] ?? [arch];
  const valid = assets.filter(
    (asset) => typeof asset?.name === 'string' && isReleaseUrl(asset?.browser_download_url, repo),
  );
  const byExt = valid.filter((asset) => asset.name.toLowerCase().endsWith(target.ext));
  if (!byExt.length) return undefined;

  const exact = byExt.find((asset) => {
    const name = asset.name.toLowerCase();
    return target.os.some((os) => arches.some((a) => name.includes(`-${os}-${a}`)));
  });
  if (exact) return exact;

  const archMatch = byExt.find((asset) => {
    const name = asset.name.toLowerCase();
    return arches.some((a) => new RegExp(`(^|[-_.])${a}([-_.]|$)`).test(name));
  });
  if (archMatch) return archMatch;

  // Universal/single-arch artifacts without an explicit arch suffix (still avoid mismatched arches).
  return byExt.find((asset) => {
    const name = asset.name.toLowerCase();
    return !ALL_ARCH_TOKENS.some((token) => new RegExp(`(^|[-_.])${token}([-_.]|$)`).test(name));
  });
}

function safeAssetName(name) {
  if (typeof name !== 'string' || !name) return undefined;
  const base = basename(name);
  if (!base || base !== name || base === '.' || base === '..' || /[\\/]/.test(base)) return undefined;
  return base;
}

function closeStream(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.closed || stream.destroyed) {
      if (stream && !stream.closed) {
        stream.once('close', resolve);
        stream.destroy();
        return;
      }
      resolve();
      return;
    }
    stream.once('close', resolve);
    stream.destroy();
  });
}

function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

function endStream(stream) {
  return new Promise((resolve, reject) => {
    const onFinish = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      stream.off('finish', onFinish);
      stream.off('error', onError);
    };
    stream.once('finish', onFinish);
    stream.once('error', onError);
    stream.end();
  });
}

export function createUpdates({
  currentVersion,
  fetch = globalThis.fetch,
  spawn = nodeSpawn,
  dir: defaultDir = join(tmpdir(), 'lomra-update'),
  repo = DEFAULT_REPO,
  platform = process.platform,
  arch = process.arch,
  isPackaged = false,
  now = () => Date.now(),
  cacheMs = CACHE_TTL_MS,
  progressIntervalMs = PROGRESS_INTERVAL_MS,
} = {}) {
  const current = normalizeVersion(currentVersion);
  let cached;
  let inFlight;
  let installing = false;

  async function runCheck() {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Lomra',
        },
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== 'object') throw new Error('Invalid release response');
      if (data.draft || data.prerelease) {
        const skipped = { current, available: false, canInstall: false };
        cached = { value: skipped, at: now() };
        return skipped;
      }
      const latest = normalizeVersion(data.tag_name);
      if (!latest) throw new Error('Release is missing a version tag');
      const asset = pickAsset(data.assets, { platform, arch, repo });
      const assetUrl = asset?.browser_download_url;
      const assetName = safeAssetName(asset?.name);
      const assetSize = typeof asset?.size === 'number' && Number.isFinite(asset.size) && asset.size >= 0
        ? asset.size
        : undefined;
      const assetSha256 = parseSha256Digest(asset?.digest);
      const result = {
        current,
        latest,
        available: compareVersions(latest, current) > 0,
        url: isReleaseUrl(data.html_url, repo) ? data.html_url : undefined,
        notes: typeof data.body === 'string' ? data.body.trim() : '',
        publishedAt: typeof data.published_at === 'string' ? data.published_at : undefined,
        assetUrl,
        assetName,
        assetSize,
        assetSha256,
        canInstall: Boolean(platform === 'win32' && isPackaged && assetSha256 && assetUrl),
      };
      cached = { value: result, at: now() };
      return result;
    } catch (error) {
      return {
        current,
        error: error instanceof Error ? error.message : 'Could not check for updates',
      };
    }
  }

  async function check(force = false) {
    const bypass = typeof force === 'boolean' ? force : Boolean(force?.force);
    if (!bypass && cached && now() - cached.at < cacheMs) return cached.value;
    if (!bypass && inFlight) return inFlight;
    const promise = runCheck();
    inFlight = promise;
    try {
      return await promise;
    } finally {
      if (inFlight === promise) inFlight = undefined;
    }
  }

  async function install({ dir = defaultDir, onProgress, signal } = {}) {
    if (installing) return { ok: false, error: 'An update is already downloading.' };
    if (platform !== 'win32') return { ok: false, error: 'In-app updates are only supported on Windows.' };
    const release = cached?.value;
    if (!release?.available) return { ok: false, error: 'No update is available.' };
    if (!isReleaseUrl(release.assetUrl, repo)) return { ok: false, error: 'Invalid release download URL.' };
    if (!release.assetSha256) return { ok: false, error: 'Release is missing a SHA-256 digest.' };
    const name = safeAssetName(release.assetName);
    if (!name || !name.toLowerCase().endsWith('.exe')) return { ok: false, error: 'Invalid installer filename.' };

    installing = true;
    const targetDir = dir;
    const finalPath = join(targetDir, name);
    const partPath = `${finalPath}.part`;
    let stream;
    let reader;

    try {
      if (signal?.aborted) return { ok: false, error: 'Update canceled.' };
      mkdirSync(targetDir, { recursive: true });
      rmSync(partPath, { force: true });

      const response = await fetch(release.assetUrl, {
        signal,
        headers: { 'User-Agent': 'Lomra' },
      });
      if (!response?.ok) throw new Error(`Download failed with HTTP ${response?.status ?? 'error'}`);
      if (!response.body) throw new Error('Download response had no body.');

      const headerLength = Number(response.headers?.get?.('content-length') ?? 0);
      const total = typeof release.assetSize === 'number' && release.assetSize > 0
        ? release.assetSize
        : Number.isFinite(headerLength) && headerLength > 0 ? headerLength : 0;

      stream = createWriteStream(partPath);
      const hash = createHash('sha256');
      let received = 0;
      let lastEmit = now();
      let lastReported = -1;

      const emit = (forceEmit = false) => {
        if (!onProgress) return;
        const currentTime = now();
        if (!forceEmit && currentTime - lastEmit < progressIntervalMs) return;
        lastEmit = currentTime;
        lastReported = received;
        onProgress({ received, total });
      };

      emit(true);

      const onAbort = () => {
        void reader?.cancel().catch(() => {});
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        if (typeof response.body.getReader === 'function') {
          reader = response.body.getReader();
          while (true) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const { done, value } = await reader.read();
            if (done) break;
            if (!value?.byteLength) continue;
            const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            hash.update(buf);
            await writeChunk(stream, buf);
            received += buf.byteLength;
            emit(false);
          }
        } else {
          for await (const chunk of response.body) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (!buf.byteLength) continue;
            hash.update(buf);
            await writeChunk(stream, buf);
            received += buf.byteLength;
            emit(false);
          }
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await endStream(stream);
      stream = undefined;

      if (received !== lastReported) emit(true);

      if (typeof release.assetSize === 'number' && received !== release.assetSize) {
        throw new Error(`Downloaded size (${received}) did not match expected size (${release.assetSize}).`);
      }
      const actualSha256 = hash.digest('hex').toLowerCase();
      if (actualSha256 !== release.assetSha256) {
        throw new Error('Downloaded installer failed SHA-256 verification.');
      }

      rmSync(finalPath, { force: true });
      renameSync(partPath, finalPath);
      return { ok: true, path: finalPath };
    } catch (error) {
      await closeStream(stream);
      rmSync(partPath, { force: true });
      if (signal?.aborted || error?.name === 'AbortError') {
        return { ok: false, error: 'Update canceled.' };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Update download failed.',
      };
    } finally {
      installing = false;
    }
  }

  function launch(installerPath) {
    const child = spawn(installerPath, ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child?.unref?.();
    return child;
  }

  return { check, install, launch };
}
