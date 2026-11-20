import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { generateGeminiMedia } from './browser-gemini.mjs';

const home = 'https://gemini.google.com/app?hl=en';
const url = 'https://gemini.google.com/app/abc123';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(12)]);
const node = (name, role = 'button') => ({ backendDOMNodeId: 1, name: { value: name }, role: { value: role } });

// A page whose controls appear as the flow progresses: sending a prompt moves it into a conversation with the result.
function run(kind, present, bytes, noMenu = false, picker = 'Open mode picker, currently Flash-Lite', auto = 'Auto', share = false) {
  if (picker) present.push([picker]);
  const images = share ? [`data:image/png;base64,${png}`] : [];
  const calls = [];
  let current = home;
  let waitingForImage = false;
  const result = generateGeminiMedia({ kind, prompt: 'A blue circle', images, aspectRatio: '16:9' }, new AbortController().signal, async () => ({
    async state() {
      if (waitingForImage) {
        waitingForImage = false;
        return { url: current, nodes: [node('ไม่สามารถสร้างวิดีโอ', 'StaticText')] };
      }
      return { url: current, nodes: present.map(([name, role]) => node(name, role)) };
    },
    async responseText() { return ''; },
    async click(control) {
      const name = control.name.value;
      calls.push(name);
      if (name === 'Open sidebar') present.push([kind === 'video' ? 'Create video' : 'Images', 'link']);
      if (name === 'Images' || name === 'Create video') {
        current = `https://gemini.google.com/u/1/app/${kind}s`;
        if (share) present.push(['Add image']);
      }
      if (name === 'Share video') present.push(['Download video', 'menuitem']);
      if (name === 'Send message' || name === 'Submit') {
        current = url;
        waitingForImage = kind === 'image' && name === 'Submit';
        present.push([share ? 'Share video' : kind === 'video' ? 'Download video' : 'Download full size image'], ['Open menu for conversation actions']);
      }
      if (name === picker) present.push([auto, 'menuitemradio']);
      if (name === 'Open menu for conversation actions' && !noMenu) present.push(['Delete', 'menuitem']);
      if (name === 'Delete' && control.role.value === 'menuitem') present.push(['Delete', 'button']);
      if (name === 'Delete' && control.role.value === 'button') current = home;
    },
    async clear() {},
    async chooseFiles(at, files, open) {
      expect(at).toBe(current);
      expect(files).toHaveLength(1);
      await open();
    },
    async fill(_control, at, input) {
      expect(at).toBe(current);
      expect(input).toContain('A blue circle\nAspect ratio: 16:9.');
      calls.push(input.startsWith('Generate') ? 'Prefixed' : 'Plain');
    },
    async download(download, at, output) {
      expect(at).toBe(url);
      expect(download.name.value).toMatch(/^Download /);
      await writeFile(output, bytes);
    },
    close() { calls.push('Close'); },
  }));
  return { result, calls };
}

test('Gemini opens Images from the sidebar and ignores unrelated refusal text while waiting', async () => {
  const { result, calls } = run('image', [['Ask Gemini', 'textbox'], ['Open sidebar'], ['Submit']], Buffer.from(png, 'base64'));
  expect(await result).toEqual({ image: `data:image/png;base64,${png}` });
  expect(calls.slice(2, 6)).toEqual(['Open sidebar', 'Images', 'Plain', 'Submit']);
}, 15_000);

test('Gemini opens Create video from the sidebar and downloads from Share', async () => {
  const picker = 'Open model picker, currently selected: Gemini Auto';
  const { result, calls } = run('video', [['Ask Gemini', 'textbox'], ['Open sidebar'], ['Submit']], mp4, false, picker, 'Auto', true);
  expect(await result).toEqual({ video: `data:video/mp4;base64,${mp4.toString('base64')}` });
  expect(calls.slice(0, 6)).toEqual(['Open sidebar', 'Create video', 'Add image', 'Plain', 'Submit', 'Share video']);
}, 10_000);

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
}, 10_000);

test('Gemini keeps Auto when it is already selected', async () => {
  const picker = 'Open model picker, currently selected: Gemini Auto';
  const { result, calls } = run('image', [['Ask Gemini', 'textbox'], ['Send message']], Buffer.from(png, 'base64'), false, picker);
  expect(await result).toEqual({ image: `data:image/png;base64,${png}` });
  expect(calls.slice(0, 2)).toEqual(['Prefixed', 'Send message']);
}, 10_000);

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
      return { url: current, nodes: current === home ? [node('Ask Gemini', 'textbox'), node('Send message')] : [] };
    },
    async responseText() { return message; },
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
