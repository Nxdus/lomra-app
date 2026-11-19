import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { control, imageType, sameUrl } from './browser-image.mjs';

const home = 'https://gemini.google.com/app?hl=en';
const conversation = /^https:\/\/gemini\.google\.com(?:\/u\/\d+)?\/app\/[\w-]+$/;
const maxImageBytes = 20 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;
const reference = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
const menuRoles = ['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'button'];
const modelPicker = /^(?:Open )?(?:model|mode) picker\b/i;
const autoModel = /^(?:Gemini )?Auto\b/i;
const autoSelected = /\bcurrently(?: selected:?| using)?\s+(?:Gemini )?Auto\b/i;

// Gemini's "limit reached / try again later" replies, in English and Thai.
const declined = /unusually high|reached (?:its|the|your) [\w ]*limits?|(?:can(?:'|’)?t|cannot|unable to) (?:create|generate) (?:videos?|images?)|try again later|ลองอีกครั้งในภายหลัง|ขีดจำกัด|ไม่สามารถสร้าง(?:วิดีโอ|วิดิโอ|รูปภาพ|ภาพ)/i;

const isHome =url => sameUrl(url, home);
const isConversation = url => conversation.test(url.split(/[?#]/)[0].replace(/\/+$/, ''));

function videoType(bytes) {
  if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'webm';
}

// Creates one image or one video through the signed-in Gemini web app and returns it as a data URL.
export async function generateGeminiMedia({ kind, prompt, images, aspectRatio } = {}, signal, openPage) {
  if ((kind !== 'image' && kind !== 'video') || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000 ||
      !Array.isArray(images) || images.length > (kind === 'video' ? 1 : 10) ||
      (aspectRatio !== undefined && (typeof aspectRatio !== 'string' || !/^\d{1,4}:\d{1,4}$/.test(aspectRatio)))) {
    throw new Error('Invalid Gemini request.');
  }
  const limit = kind === 'video' ? maxVideoBytes : maxImageBytes;
  let total = 0;
  const references = images.map(value => {
    if (typeof value !== 'string' || value.length > Math.ceil(maxImageBytes / 3) * 4 + 64) throw new Error('Invalid reference image.');
    const match = reference.exec(value);
    if (!match) throw new Error('Gemini accepts PNG, JPEG, WebP and GIF references.');
    const bytes = Buffer.from(match[2], 'base64');
    total += bytes.length;
    if (!bytes.length || total > maxImageBytes) throw new Error('Reference images must total at most 20 MB.');
    return { type: match[1], bytes };
  });
  signal.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), 'lomra-gemini-'));
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
      if (signIns++ || !await page.signIn()) throw new Error('Sign in to Gemini in the Lomra sign-in window, then retry.');
    }
    // Waits for a control by accessible name; `url` pins the page once the request has created its conversation.
    let seen = [];
    async function waitFor(name, { url, timeout = 15_000, role = 'button', error, interval = 600, allowSignIn = false, find = state => control(state, name, role) }) {
      let deadline = Date.now() + timeout;
      for (;;) {
        signal.throwIfAborted();
        if (Date.now() >= deadline) {
          if (allowSignIn && !signIns) {
            await signIn();
            deadline = Date.now() + timeout;
            continue;
          }
          throw new Error(error && `${error} (controls seen: ${seen.join(', ') || 'none'})`);
        }
        const state = await page.state();
        seen = state.nodes.filter(node => ['button', 'textbox', 'menuitem'].includes(node.role?.value) && node.name?.value).map(node => node.name.value.slice(0, 40)).slice(-15);
        if (allowSignIn && (control(state, /^(Log in|Sign in)$/i) || control(state, /^(Log in|Sign in)$/i, 'link'))) {
          await signIn();
          deadline = Date.now() + timeout;
          continue;
        }
        if ((url && !sameUrl(state.url, url)) || (!url && !isHome(state.url) && !isConversation(state.url))) {
          throw new Error('The Gemini page navigated away from this request.');
        }
        if (!url && isConversation(state.url)) url = state.url;
        const node = find(state);
        if (node) return { node, url: state.url };
        await delay(interval, undefined, { signal });
      }
    }
    const optional = (name, options) => waitFor(name, { ...options, error: '' }).catch(cause => {
      signal.throwIfAborted();
      if (cause.message) throw cause;
    });

    const composer = await waitFor(/(?:)/, { url: home, role: 'textbox', allowSignIn: true, error: 'Could not find the Gemini prompt box.' });
    await page.clear?.(home);

    // Best effort: Gemini remembers the last mode it was used in, so choose Auto explicitly.
    let mode;
    const findPicker = state => control(state, modelPicker) ?? control({
      nodes: state.nodes.filter(node => node.properties?.some(({ name, value }) => name === 'hasPopup' && ['menu', 'listbox'].includes(value.value))),
    }, /^(?:Gemini )?(?:Auto|Flash-Lite|Flash|Fast|Thinking|Pro)$/i);
    const picker = await optional(modelPicker, { url: home, timeout: 4000, find: findPicker });
    if (!picker) mode = 'Could not verify Auto in Gemini. Check Settings → Usage limits → Auto model selection.';
    else if (!autoSelected.test(picker.node.name.value) && !autoModel.test(picker.node.name.value)) {
      await page.click(picker.node, home);
      const auto = await optional(autoModel, { url: home, role: menuRoles, timeout: 4000 });
      if (auto) await page.click(auto.node, home);
      else {
        mode = 'Gemini did not offer Auto in the model picker. Check Settings → Usage limits → Auto model selection.';
        await page.click(picker.node, home);
      }
    }
    if (paths.length) {
      const menu = await waitFor(/^(?:Upload & tools|Open upload file menu|Add files?)\b/i, { url: home, error: 'Could not open the Gemini upload menu.' });
      await page.chooseFiles(home, paths, async () => {
        await page.click(menu.node, home);
        const upload = await waitFor(/^Upload files?\b/i, { url: home, role: menuRoles, error: 'Could not find Gemini file upload.' });
        await page.click(upload.node, home);
      });
      await delay(1500, undefined, { signal });
    }

    // Best effort: without the tool chip the prompt is still prefixed so Gemini knows what to make.
    let tool = false;
    const tools = await optional(/^(?:Upload & tools|Tools)\b/i, { url: home, timeout: 4000 });
    if (tools) {
      await page.click(tools.node, home);
      const create = await optional(new RegExp(`^(?:Create|Generate) ${kind}s?\\b`, 'i'), { url: home, role: menuRoles, timeout: 4000 });
      if (create) {
        await page.click(create.node, home);
        tool = true;
      }
    }
    const lead = tool ? '' : kind === 'video' ? 'Generate a video. ' : 'Generate an image. ';
    const refs = paths.length ? (kind === 'video' ? 'Animate the attached image into a video. ' : 'Create an image using the attached references in order. ') : '';
    await page.fill(composer.node, home, `${lead}${refs}${prompt.trim()}${aspectRatio ? `\nAspect ratio: ${aspectRatio}.` : ''}`);
    const send = await waitFor(/^Send(?: message)?$/i, { url: home, error: 'Gemini is not ready to send the prompt.', timeout: 45_000 });
    await page.click(send.node, home);

    const done = kind === 'video' ? /^Download video\b/i : /^Download (?:full size )?image\b/i;
    // Gemini answers a usage limit or busy system with plain text and no media: stop waiting and show it.
    const own = prompt.trim().slice(0, 30);
    let refusal;
    const result = await waitFor(done, {
      timeout: kind === 'video' ? 15 * 60_000 : 6 * 60_000, interval: 2500,
      find: state => control(state, done) ?? (refusal = state.nodes.find(node => !node.ignored && node.name?.value?.length < 600 &&
        declined.test(node.name.value) && !node.name.value.includes(own))),
      error: `Gemini did not return a ${kind} in time. Check your Gemini activity for the result or a usage limit.`,
    });
    if (result.node === refusal) throw new Error(`Gemini could not create the ${kind}: ${refusal.name.value}`);
    const url = result.url;
    if (!isConversation(url)) throw new Error('Could not identify the Gemini conversation.');
    const output = join(dir, `generated-${kind}`);
    let bytes;
    try {
      await page.download(result.node, url, output, kind === 'video' ? 120_000 : 45_000);
      if ((await stat(output)).size > limit) throw new Error(`The downloaded ${kind} is too large.`);
      bytes = await readFile(output);
    } catch (error) {
      signal.throwIfAborted();
      // Gemini changes how its download control saves files: read the media the page shows instead.
      const data = await page.fetchMedia?.(url, kind, limit).catch(() => undefined);
      if (!data) throw error;
      bytes = Buffer.from(data, 'base64');
    }
    const type = kind === 'video' ? videoType(bytes) : imageType(bytes);
    if (!type) throw new Error(`Gemini did not download a supported ${kind} file.`);
    const media = { [kind]: `data:${kind}/${type};base64,${bytes.toString('base64')}` };

    // Best effort: the media is already saved, so a changed menu only leaves the chat in Gemini's history.
    try {
      const actions = await waitFor(/conversation actions/i, { url, error: 'Chat actions unavailable.' });
      await page.click(actions.node, url);
      const remove = await waitFor(/^Delete\b/i, { url, role: 'menuitem', error: 'Delete unavailable.' });
      await page.click(remove.node, url);
      const confirm = await waitFor(/^Delete$/i, { url, error: 'Delete confirmation unavailable.' });
      await page.click(confirm.node, url);
      const deadline = Date.now() + 8000;
      let state = await page.state();
      while (sameUrl(state.url, url) && Date.now() < deadline) {
        await delay(500, undefined, { signal });
        state = await page.state();
      }
      if (sameUrl(state.url, url)) throw new Error('Delete unconfirmed.');
    } catch (cause) {
      signal.throwIfAborted();
      return { ...media, warning: [mode, `The ${kind} was downloaded. Could not delete the Gemini chat: ${url}`].filter(Boolean).join(' ') };
    }
    return mode ? { ...media, warning: mode } : media;
  } finally {
    page?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
