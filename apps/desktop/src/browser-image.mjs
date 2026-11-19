import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const home = 'https://chatgpt.com/';
const conversation = /^https:\/\/chatgpt\.com(?:\/g\/[\w-]+)?\/c\/[\w-]+$/;
const maxBytes = 20 * 1024 * 1024;
const reference = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

// ChatGPT rewrites query strings, hashes and trailing slashes while a chat loads; only the origin and path identify a page.
export const pageKey = url => {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname.replace(/\/+$/, '');
  } catch { return String(url); }
};
export const sameUrl = (a, b) => pageKey(a) === pageKey(b);
const isHome = url => sameUrl(url, home);
const isConversation = url => conversation.test(pageKey(url));

// The composer's thinking-effort picker, and its levels from highest to lowest preference.
const effortButton = /^(?:\d+\s*)?(?:Light|Low|Medium|Standard|Extended|High|Heavy|Max(?:imum)?|Extra high)\b/i;
const effortLevels = [/^(?:Max|Maximum)\b/i, /^Heavy\b/i, /^Extra high\b/i, /^Extended\b/i, /^High\b/i];
const menuRoles = ['menuitem', 'menuitemradio', 'option'];

export function control({ nodes }, name, role = 'button') {
  return nodes.find(node => !node.ignored && node.backendDOMNodeId && [].concat(role).includes(node.role?.value) &&
    name.test(node.name?.value ?? '') && !node.properties?.some(({ name, value }) => name === 'disabled' && value.value));
}

export function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
}

export async function generateBrowserImage({ prompt, images, aspectRatio } = {}, signal, openPage) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000 ||
      !Array.isArray(images) || images.length > 10 ||
      (aspectRatio !== undefined && (typeof aspectRatio !== 'string' || !/^\d{1,4}:\d{1,4}$/.test(aspectRatio)))) {
    throw new Error('Invalid ChatGPT image request.');
  }
  let total = 0;
  const references = images.map(value => {
    if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 64) throw new Error('Invalid reference image.');
    const match = reference.exec(value);
    if (!match) throw new Error('ChatGPT accepts PNG, JPEG, WebP and GIF references.');
    const bytes = Buffer.from(match[2], 'base64');
    total += bytes.length;
    if (!bytes.length || total > maxBytes) throw new Error('Reference images must total at most 20 MB.');
    return { type: match[1], bytes };
  });
  signal.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), 'lomra-image-'));
  let page;
  try {
    const paths = await Promise.all(references.map(async ({ type, bytes }, index) => {
      const path = join(dir, `reference-${index + 1}.${type}`);
      await writeFile(path, bytes);
      return path;
    }));
    page = await openPage(signal);
    let signIns = 0;
    async function signIn() {
      if (signIns++ || !await page.signIn()) throw new Error('Sign in to ChatGPT in the Lomra sign-in window, then retry.');
    }
    async function waitFor(name, { url, timeout = 15_000, role, error, interval = 600, allowSignIn = false }) {
      let deadline = Date.now() + timeout;
      for (;;) {
        signal.throwIfAborted();
        if (Date.now() >= deadline) {
          if (allowSignIn && !signIns) {
            await signIn();
            deadline = Date.now() + timeout;
            continue;
          }
          throw new Error(error);
        }
        const state = await page.state();
        if (allowSignIn && (control(state, /^(Log in|Sign in)$/i) || control(state, /^(Log in|Sign in)$/i, 'link'))) {
          await signIn();
          deadline = Date.now() + timeout;
          continue;
        }
        if ((url && !sameUrl(state.url, url)) || (!url && !isHome(state.url) && !isConversation(state.url))) {
          throw new Error('The ChatGPT page navigated away from this image request.');
        }
        if (!url && isConversation(state.url)) url = state.url;
        const node = control(state, name, role);
        if (node) return { node, url: state.url };
        await delay(interval, undefined, { signal });
      }
    }

    // Best effort: a missing or renamed picker only means the image is made at ChatGPT's default effort.
    async function maxThinking() {
      const find = async (match, timeout) => {
        for (const end = Date.now() + timeout; ; await delay(400, undefined, { signal })) {
          signal.throwIfAborted();
          const state = await page.state();
          if (!isHome(state.url)) return;
          const found = match(state);
          if (found || Date.now() >= end) return found;
        }
      };
      let seen = [];
      const missing = () => `Could not set ChatGPT thinking to the maximum (buttons seen: ${seen.join(', ') || 'none'}).`;
      const picker = await find(state => {
        seen = state.nodes.filter(node => node.role?.value === 'button' && node.name?.value).map(node => node.name.value.slice(0, 40)).slice(-15);
        return control(state, effortButton);
      }, 3000);
      if (!picker) return missing();
      if (effortLevels.slice(0, 2).some(level => level.test(picker.name.value.replace(/^\d+\s*/, '')))) return;
      await page.click(picker, home);
      const level = await find(state => {
        for (const name of effortLevels) { const node = control(state, name, menuRoles); if (node) return node; }
      }, 3000);
      if (!level) return missing();
      await page.click(level, home);
    }

    const composer = await waitFor(/^Ask ChatGPT$/i, { url: home, role: 'textbox', allowSignIn: true });
    await page.clear?.(home);
    if (paths.length) await page.upload(home, paths);
    const input = `${paths.length ? 'Create an image using the attached references in order. ' : 'Create one image. '}\n${prompt.trim()}${aspectRatio ? `\nAspect ratio: ${aspectRatio}.` : ''}`;
    const add = await waitFor(/^Add files and more$/i, { url: home, error: 'Could not open the ChatGPT tools menu.' });
    await page.click(add.node, home);
    const create = await waitFor(/^Create image\b/i, { url: home, error: 'Create image is unavailable in this ChatGPT session.' });
    await page.click(create.node, home);
    const thinking = await maxThinking();
    // Fill after the tool is chosen: the chip is inserted at the caret and would otherwise split the prompt.
    await page.fill(composer.node, home, input);
    const send = await waitFor(/^Send(?: prompt)?$/i, { url: home, error: 'ChatGPT is not ready to send the image prompt.', timeout: 45_000 });
    await page.click(send.node, home);

    const preview = await waitFor(/^Generated image \d+$/i, { timeout: 8 * 60_000, interval: 2500, error: 'ChatGPT did not return an image in time. Check your ChatGPT history for the result or a usage limit.' });
    const url = preview.url;
    if (!isConversation(url)) throw new Error('Could not identify the ChatGPT image conversation.');
    await page.click(preview.node, url);
    const output = join(dir, 'generated-image');
    let bytes;
    try {
      const download = await waitFor(/^(?:Download|Save)\b/i, { url, timeout: 10_000, error: 'Could not find the original image download.' });
      await page.download(download.node, url, output);
      if ((await stat(output)).size > maxBytes) throw new Error('The downloaded image exceeds 20 MB.');
      bytes = await readFile(output);
    } catch (error) {
      signal.throwIfAborted();
      // ChatGPT renames and moves the viewer's download control between releases: read the image the viewer shows instead.
      const data = await page.fetchImage?.(url, maxBytes).catch(() => undefined);
      if (!data) throw error;
      bytes = Buffer.from(data, 'base64');
    }
    const type = imageType(bytes);
    if (!type) throw new Error('ChatGPT did not download a supported image file.');
    const image = `data:image/${type};base64,${bytes.toString('base64')}`;

    try {
      const viewer = await waitFor(/^Close viewer$/i, { url, error: 'Could not close the image viewer.' });
      await page.click(viewer.node, url);
      if (!await page.openArchiveMenu(url)) throw new Error('Chat actions unavailable.');
      const archive = await waitFor(/^Archive(?: chat)?$/i, { url, role: 'menuitem', error: 'Archive unavailable.' });
      await page.click(archive.node, url);
      const deadline = Date.now() + 5000;
      let archived = await page.state();
      while (sameUrl(archived.url, url) && Date.now() < deadline) {
        await delay(500, undefined, { signal });
        archived = await page.state();
      }
      if (!isHome(archived.url)) throw new Error('Archive unconfirmed.');
    } catch {
      signal.throwIfAborted();
      return { image, warning: [thinking, `Image downloaded. Could not verify ChatGPT conversation cleanup: ${url}`].filter(Boolean).join(' ') };
    }
    return thinking ? { image, warning: thinking } : { image };
  } finally {
    page?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
