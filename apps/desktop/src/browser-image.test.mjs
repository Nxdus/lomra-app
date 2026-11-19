import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { generateBrowserImage } from './browser-image.mjs';

const home = 'https://chatgpt.com/';
const url = `${home}c/created-chat`;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
const image = `data:image/png;base64,${png}`;
const node = (name, role = 'button') => ({ backendDOMNodeId: 1, name: { value: name }, role: { value: role } });

test('the background ChatGPT page uploads references, submits once and only archives a downloaded result', async () => {
  for (const validDownload of [true, false]) {
    const calls = [];
    const controls = [
      ['Ask ChatGPT', 'textbox'],
      ['Add files and more'], ['Create image Visualize anything'], ['6 Medium'], ['Heavy', 'menuitem'], ['Send'],
      ['Generated image 1', 'button', url], ['Download', 'button', url],
      ['Close viewer', 'button', url], ['Archive', 'menuitem', url],
    ];
    const result = generateBrowserImage({ prompt: 'A blue circle', images: [image], aspectRatio: '1:1' },
      new AbortController().signal, async () => ({
        async state() {
          const [name, role, current = home] = controls.shift() ?? [];
          return { url: current, nodes: name ? [node(name, role)] : [] };
        },
        async click(control, current) {
          expect([home, url]).toContain(current);
          calls.push(control.name.value);
        },
        async clear(current) {
          expect(current).toBe(home);
          calls.push('Clear');
        },
        async upload(current, [file]) {
          expect(current).toBe(home);
          expect((await readFile(file)).toString('base64')).toBe(png);
        },
        async fill(_control, current, input) {
          expect(current).toBe(home);
          expect(input).toContain('A blue circle\nAspect ratio: 1:1.');
        },
        async download(_control, current, output) {
          expect(current).toBe(url);
          calls.push('Download');
          await writeFile(output, validDownload ? Buffer.from(png, 'base64') : 'not a picture');
        },
        async openArchiveMenu(current) {
          expect(current).toBe(url);
          return true;
        },
        close() { calls.push('Close'); },
      }));
    const steps = ['Clear', 'Add files and more', 'Create image Visualize anything', '6 Medium', 'Heavy', 'Send', 'Generated image 1', 'Download'];
    if (validDownload) {
      expect(await result).toEqual({ image });
      expect(calls).toEqual([...steps, 'Close viewer', 'Archive', 'Close']);
    } else {
      await expect(result).rejects.toThrow('supported image');
      expect(calls).toEqual([...steps, 'Close']);
    }
  }
});

test('a signed-out session opens sign-in before sending any image request', async () => {
  const calls = [];
  await expect(generateBrowserImage({ prompt: 'A blue circle', images: [] },
    new AbortController().signal, async () => ({
      async state() { return { url: home, nodes: [node('Log in', 'link'), node('Ask ChatGPT', 'textbox')] }; },
      async signIn() { calls.push('Sign in'); return false; },
      close() { calls.push('Close'); },
    }))).rejects.toThrow('Sign in to ChatGPT');
  expect(calls).toEqual(['Sign in', 'Close']);
});

test('after signing in the image request continues without a retry', async () => {
  let signedIn = false;
  const calls = [];
  const state = () => ({ url: home, nodes: signedIn ? [node('Ask ChatGPT', 'textbox'), node('Add files and more')] : [node('Log in', 'link')] });
  await expect(generateBrowserImage({ prompt: 'A blue circle', images: [] },
    new AbortController().signal, async () => ({
      async state() { return state(); },
      async signIn() { calls.push('Sign in'); signedIn = true; return true; },
      async click() { calls.push('Menu'); throw new Error('stop'); },
      close() {},
    }))).rejects.toThrow('stop');
  expect(calls).toEqual(['Sign in', 'Menu']);
});

test('a missing thinking picker does not stop the image request', async () => {
  const calls = [];
  const next = [['Add files and more'], ['Create image Visualize anything'], ['Send']];
  await expect(generateBrowserImage({ prompt: 'A blue circle', images: [] },
    new AbortController().signal, async () => ({
      async state() { return { url: home, nodes: [node('Ask ChatGPT', 'textbox'), ...(next[calls.filter(call => call !== 'Fill').length] ?? []).map(name => node(name))] }; },
      async click(control) { calls.push(control.name.value); if (control.name.value === 'Send') throw new Error('stop'); },
      async fill() { calls.push('Fill'); },
      close() {},
    }))).rejects.toThrow('stop');
  expect(calls).toEqual(['Add files and more', 'Create image Visualize anything', 'Fill', 'Send']);
}, 10_000);
