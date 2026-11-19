import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { generateGeminiMedia } from './browser-gemini.mjs';

const home = 'https://gemini.google.com/app?hl=en';
const url = 'https://gemini.google.com/app/abc123';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(12)]);
const node = (name, role = 'button') => ({ backendDOMNodeId: 1, name: { value: name }, role: { value: role } });

// A page whose controls appear as the flow progresses: sending a prompt moves it into a conversation with the result.
function run(kind, present, bytes, noMenu = false, picker = 'Open mode picker, currently Flash-Lite', auto = 'Auto') {
  if (picker) present.push([picker]);
  const calls = [];
  let current = home;
  const result = generateGeminiMedia({ kind, prompt: 'A blue circle', images: [], aspectRatio: '16:9' }, new AbortController().signal, async () => ({
    async state() {
      return { url: current, nodes: present.map(([name, role]) => node(name, role)) };
    },
    async click(control) {
      const name = control.name.value;
      calls.push(name);
      if (name === 'Send message') {
        current = url;
        present.push([kind === 'video' ? 'Download video' : 'Download full size image'], ['Open menu for conversation actions']);
      }
      if (name === picker) present.push([auto, 'menuitemradio']);
      if (name === 'Open menu for conversation actions' && !noMenu) present.push(['Delete', 'menuitem']);
      if (name === 'Delete' && control.role.value === 'menuitem') present.push(['Delete', 'button']);
      if (name === 'Delete' && control.role.value === 'button') current = home;
    },
    async clear() {},
    async fill(_control, at, input) {
      expect(at).toBe(home);
      expect(input).toContain('A blue circle\nAspect ratio: 16:9.');
      calls.push(input.startsWith('Generate') ? 'Prefixed' : 'Plain');
    },
    async download(_control, at, output) {
      expect(at).toBe(url);
      await writeFile(output, bytes);
    },
    close() { calls.push('Close'); },
  }));
  return { result, calls };
}

test('Gemini creates an image with the tool chip and downloads it', async () => {
  const { result, calls } = run('image', [['Ask Gemini', 'textbox'], ['Upload & tools'], ['Create image', 'menuitemcheckbox'], ['Send message']], Buffer.from(png, 'base64'));
  expect(await result).toEqual({ image: `data:image/png;base64,${png}` });
  expect(calls).toEqual(['Open mode picker, currently Flash-Lite', 'Auto', 'Upload & tools', 'Create image', 'Plain', 'Send message', 'Open menu for conversation actions', 'Delete', 'Delete', 'Close']);
});

test('Gemini selects Auto from the model picker before sending an image prompt', async () => {
  const picker = 'Open model picker, currently selected: Flash-Lite';
  const { result, calls } = run('image', [['Ask Gemini', 'textbox'], ['Send message']], Buffer.from(png, 'base64'), false, picker, 'Gemini Auto');
  expect(await result).toEqual({ image: `data:image/png;base64,${png}` });
  expect(calls.slice(0, 4)).toEqual([picker, 'Gemini Auto', 'Prefixed', 'Send message']);
});

test('Gemini keeps Auto when it is already selected', async () => {
  const picker = 'Open model picker, currently selected: Gemini Auto';
  const { result, calls } = run('image', [['Ask Gemini', 'textbox'], ['Send message']], Buffer.from(png, 'base64'), false, picker);
  expect(await result).toEqual({ image: `data:image/png;base64,${png}` });
  expect(calls.slice(0, 2)).toEqual(['Prefixed', 'Send message']);
});

test('Gemini creates a video, prefixing the prompt when the tool is missing, and rejects non-video downloads', async () => {
  const page = () => [['Ask Gemini', 'textbox'], ['Send message']];
  const { result, calls } = run('video', page(), mp4);
  expect(await result).toEqual({ video: `data:video/mp4;base64,${mp4.toString('base64')}` });
  expect(calls).toEqual(['Open mode picker, currently Flash-Lite', 'Auto', 'Prefixed', 'Send message', 'Open menu for conversation actions', 'Delete', 'Delete', 'Close']);
  await expect(run('video', page(), Buffer.from('not a video')).result).rejects.toThrow('supported video');
}, 20_000);

test('Gemini still returns the media, with a warning, when the chat cannot be deleted', async () => {
  const { result } = run('image', [['Ask Gemini', 'textbox'], ['Send message']], Buffer.from(png, 'base64'), true);
  expect(await result).toEqual({ image: `data:image/png;base64,${png}`, warning: `The image was downloaded. Could not delete the Gemini chat: ${url}` });
}, 20_000);

test('Gemini warns when it cannot find the model picker', async () => {
  const { result } = run('image', [['Ask Gemini', 'textbox'], ['Send message']], Buffer.from(png, 'base64'), false, false);
  const { warning } = await result;
  expect(warning).toContain('Settings → Usage limits → Auto model selection');
}, 20_000);

test('Gemini stops waiting when it replies with a usage limit instead of a video', async () => {
  const message = 'ขออภัย ขณะนี้มีปริมาณการสร้างวิดีโอสูงผิดปกติและระบบถึงขีดจำกัดด้านประสิทธิภาพแล้ว โปรดลองอีกครั้งในภายหลัง';
  let current = home;
  const refused = generateGeminiMedia({ kind: 'video', prompt: 'A blue circle', images: [] }, new AbortController().signal, async () => ({
    async state() {
      return { url: current, nodes: current === home ? [node('Ask Gemini', 'textbox'), node('Send message')] : [node(message, 'StaticText')] };
    },
    async click(control) { if (control.name.value === 'Send message') current = url; },
    async clear() {}, async fill() {}, close() {},
  }));
  await expect(refused).rejects.toThrow('could not create the video');
}, 20_000);

test('Gemini rejects invalid requests before opening a page', async () => {
  const open = async () => { throw new Error('opened'); };
  await expect(generateGeminiMedia({ kind: 'audio', prompt: 'x', images: [] }, new AbortController().signal, open)).rejects.toThrow('Invalid Gemini request');
  await expect(generateGeminiMedia({ kind: 'video', prompt: 'x', images: [`data:image/png;base64,${png}`, `data:image/png;base64,${png}`] }, new AbortController().signal, open)).rejects.toThrow('Invalid Gemini request');
});
