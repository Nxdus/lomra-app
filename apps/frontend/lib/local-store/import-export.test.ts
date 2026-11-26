// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { test, expect } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js';
import { exportProject, importProject } from './import-export';
import { createLocalStore } from './store';
import { canvasCardType, type CanvasHarness } from '../image-canvas/canvas-harness';
import { canvasHandoff, canvasHandoffZip } from '../image-canvas/canvas-harness-export';

const item = (id: string, x = 0, y = 0) => ({
  id,
  name: `${id}.png`,
  type: 'image/png',
  lastModified: 1700000000000,
  x,
  y,
  width: 100,
  height: 100,
});

async function makeStore() {
  const root = await mkdtemp(join(tmpdir(), 'lomra-port-'));
  return { root, store: createLocalStore(root, Buffer.alloc(32, 7)) };
}

test('canvas cards and generation provenance survive project import, and handoffs include only selected assets', async () => {
  const { store } = await makeStore();
  const brief = { ...item('brief'), type: canvasCardType, harness: { role: 'Brief', title: 'Lamp brief' } satisfies CanvasHarness };
  const output = { ...item('output'), harness: {
    role: 'Output',
    links: [{ to: brief.id, relation: 'Continues from' }],
    provenance: { model: 'model', prompt: 'Warm lamp', aspectRatio: '4:3', selectedInputs: [{ id: 'ref', name: 'Reference' }], sd: { seed: 42, steps: 20, cfg: 7, strength: 0.6, negativePrompt: 'blur', image: true, mask: true } },
  } satisfies CanvasHarness };
  const reference = item('ref');
  const saved = [brief, reference, output];
  await Promise.all(saved.map(item => store.writeFile(item.id, Uint8Array.of(42))));
  await store.save('canvas', 'default', saved);
  await expect(store.save('canvas', 'default', [output])).rejects.toThrow('Invalid saved state');
  const { archive } = await exportProject(store, 'default');
  const imported = await importProject(store, archive);
  const mapped = (await store.list('canvas')).find(row => row.id === imported.canvasId)!.value as typeof saved;
  const [newBrief, newReference, newOutput] = mapped;
  expect(newOutput).toMatchObject({ harness: {
    links: [{ to: newBrief.id, relation: 'Continues from' }],
    provenance: { prompt: 'Warm lamp', aspectRatio: '4:3', selectedInputs: [{ id: newReference.id, name: 'Reference' }], sd: output.harness.provenance.sd },
  } });
  const items = saved.map(item => ({ ...item, file: new File([Uint8Array.of(42)], item.name, { type: item.type }) }));
  const handoff = canvasHandoff(items, new Set(['brief', 'output']));
  expect(handoff.markdown).toContain('Continues from: Lamp brief (brief)');
  expect(handoff.markdown).toContain('Warm lamp');
  expect(handoff.markdown).toContain('- Aspect ratio: 4:3\n');
  expect(handoff.markdown).toContain('- Seed: 42\n- Steps: 20\n- CFG scale: 7\n- Started from: Picture, brushed area only\n- Strength: 0\\.6\n- Negative prompt: blur\n');
  const zip = await canvasHandoffZip(handoff.markdown, handoff.assets);
  expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())))).toEqual(['canvas.md', 'files/output-output.png']);
});

test('project export and import round-trip preserves canvas items, layout, chats, storyboard, takes, timeline audio and files with mapped IDs', async () => {
  const { store: s } = await makeStore();

  const originalCanvasId = 'canvas-1700000000000-00000000-0000-0000-0000-000000000001';
  const cItem1 = item('img-1', 10, 20);
  const cItem2 = item('img-2', 150, 200);

  await s.save('canvas', originalCanvasId, [cItem1, cItem2]);
  await s.writeFile('img-1', new Uint8Array([10, 11, 12]));
  await s.writeFile('img-2', new Uint8Array([20, 21, 22]));

  await s.save('settings', `canvas-name-${originalCanvasId}`, 'Animation Odyssey');
  await s.save('settings', `camera-${originalCanvasId}`, { x: 50, y: -25, scale: 1.5 });

  // Storyboard files: character, shot frame, video take, audio, stitched video
  await s.writeFile('char-gen', new Uint8Array([30]));
  await s.writeFile('shot-gen', new Uint8Array([40]));
  await s.writeFile('take-file', new Uint8Array([60]));
  await s.writeFile('narration-audio', new Uint8Array([70]));
  await s.writeFile('stitched-video', new Uint8Array([80]));

  const originalChat = {
    id: 'chat-film',
    canvasId: originalCanvasId,
    title: 'Film Script & Storyboard',
    updatedAt: 1700000001000,
    history: [
      { role: 'user', content: 'Generate character and scenes', images: [{ name: 'ref.jpg', url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }] },
      { role: 'assistant', content: 'Here is the storyboard.' },
    ],
    generations: [
      { id: 'gen-1', category: 'picture', model: 'flux', prompt: 'Hero', status: 'Completed', files: [{ kind: 'file', name: 'gen.png', url: '/api/storage/files/shot-gen' }] },
    ],
    models: ['flux'],
    storyboard: {
      story: 'An epic tale of adventure.',
      characters: [
        { name: 'Kael', notes: 'Blue cloak', image: null, generatedId: 'char-gen', approved: true },
      ],
      shots: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          description: 'Wide shot of valley',
          seconds: 4,
          image: null,
          references: [],
          characters: [0],
          generatedId: 'shot-gen',
          videoId: 'take-file',
          selectedTakeId: 'take-file',
          takes: [
            { fileId: 'take-file', source: { frame: null, prompt: 'Kael looking at valley' } },
          ],
        },
      ],
      timeline: {
        aspectRatio: '16:9',
        trims: [{ fileId: 'take-file', start: 0, end: 4, mute: false }],
        audio: [{ fileId: 'narration-audio', name: 'voice.wav', kind: 'narration', start: 0, seconds: 4, gain: 1 }],
        captions: [],
      },
      videoItemId: 'stitched-video',
    },
  };
  await s.save('chats', originalChat.id, originalChat);

  // Add unrelated data and API keys to verify exclusion
  await s.save('keys', 'openrouter', 'sk-or-secret-key-12345');
  await s.save('settings', 'disabled-agents', ['opencode']);
  await s.save('canvas', 'default', [item('unrelated-item')]);
  await s.writeFile('unrelated-item', new Uint8Array([99]));

  // EXPORT
  const { filename, archive } = await exportProject(s, originalCanvasId);
  expect(filename).toBe('Animation Odyssey.lomra');
  expect(archive.byteLength).toBeGreaterThan(0);

  // Inspect ZIP contents
  const unzipped = unzipSync(archive);
  expect(Object.keys(unzipped)).toContain('manifest.json');
  expect(Object.keys(unzipped)).toContain('files/img-1');
  expect(Object.keys(unzipped)).toContain('files/img-2');
  expect(Object.keys(unzipped)).toContain('files/char-gen');
  expect(Object.keys(unzipped)).toContain('files/shot-gen');
  expect(Object.keys(unzipped)).toContain('files/take-file');
  expect(Object.keys(unzipped)).toContain('files/narration-audio');
  expect(Object.keys(unzipped)).toContain('files/stitched-video');

  // Verify secrets and unrelated items are strictly excluded
  expect(Object.keys(unzipped)).not.toContain('files/unrelated-item');
  const manifestText = strFromU8(unzipped['manifest.json']);
  expect(manifestText).not.toContain('sk-or-secret-key-12345');
  expect(manifestText).not.toContain('unrelated-item');

  // IMPORT into a clean store
  const { store: s2 } = await makeStore();
  const importResult = await importProject(s2, archive);

  expect(importResult.name).toBe('Animation Odyssey');
  expect(importResult.itemCount).toBe(2);
  expect(importResult.canvasId).toMatch(/^canvas-\d{13}-[a-f0-9-]{36}$/);
  expect(importResult.canvasId).not.toBe(originalCanvasId);

  // Check imported canvas items & layout
  const importedCanvases = await s2.list('canvas');
  expect(importedCanvases.length).toBe(1);
  const importedCanvas = importedCanvases[0];
  expect(importedCanvas.id).toBe(importResult.canvasId);
  const items = importedCanvas.value as Array<ReturnType<typeof item>>;
  expect(items.length).toBe(2);
  expect(items[0].x).toBe(10);
  expect(items[0].y).toBe(20);
  expect(items[1].x).toBe(150);
  expect(items[1].y).toBe(200);

  // IDs must be remapped to new UUIDs
  expect(items[0].id).not.toBe('img-1');
  expect(items[1].id).not.toBe('img-2');
  expect([...await s2.readFile(items[0].id)]).toEqual([10, 11, 12]);
  expect([...await s2.readFile(items[1].id)]).toEqual([20, 21, 22]);

  // Check imported settings
  const importedSettings = await s2.list('settings');
  expect(importedSettings.find((r) => r.id === `canvas-name-${importResult.canvasId}`)?.value).toBe('Animation Odyssey');
  expect(importedSettings.find((r) => r.id === `camera-${importResult.canvasId}`)?.value).toEqual({ x: 50, y: -25, scale: 1.5 });

  // Check imported chats
  const importedChats = await s2.list('chats');
  expect(importedChats.length).toBe(1);
  const importedChat = importedChats[0].value as typeof originalChat;
  expect(importedChat.id).not.toBe(originalChat.id);
  expect(importedChat.canvasId).toBe(importResult.canvasId);
  expect(importedChat.title).toBe(originalChat.title);
  expect(importedChat.storyboard?.story).toBe('An epic tale of adventure.');

  // Check storyboard and takes remapping
  const board = importedChat.storyboard!;
  expect(board.characters![0].generatedId).not.toBe('char-gen');
  expect([...await s2.readFile(board.characters![0].generatedId!)]).toEqual([30]);

  const shot = board.shots![0];
  expect(shot.generatedId).not.toBe('shot-gen');
  expect([...await s2.readFile(shot.generatedId!)]).toEqual([40]);
  expect(shot.videoId).not.toBe('take-file');
  expect(shot.videoId).toBe(shot.takes![0].fileId);
  expect([...await s2.readFile(shot.videoId!)]).toEqual([60]);

  // Takes & timeline audio
  expect(shot.takes![0].fileId).not.toBe('take-file');
  expect(shot.selectedTakeId).toBe(shot.takes![0].fileId);
  expect(board.timeline!.trims[0].fileId).toBe(shot.takes![0].fileId);
  expect([...await s2.readFile(shot.takes![0].fileId)]).toEqual([60]);

  expect(board.timeline!.audio[0].fileId).not.toBe('narration-audio');
  expect([...await s2.readFile(board.timeline!.audio[0].fileId)]).toEqual([70]);

  expect(board.videoItemId).not.toBe('stitched-video');
  expect([...await s2.readFile(board.videoItemId!)]).toEqual([80]);

  // Check chat generation file url remapped
  expect(importedChat.generations[0].files![0].url).toBe(`/api/storage/files/${shot.generatedId}`);
});

test('importing into the same store keeps both projects safe with independent files', async () => {
  const { store: s } = await makeStore();

  const canvasId = 'canvas-1700000000000-00000000-0000-0000-0000-000000000001';
  await s.save('canvas', canvasId, [item('source-file')]);
  await s.writeFile('source-file', new Uint8Array([1, 2, 3]));
  await s.save('settings', `canvas-name-${canvasId}`, 'Project A');

  const { archive } = await exportProject(s, canvasId);
  const imported = await importProject(s, archive);

  // Both canvases exist
  const canvases = await s.list('canvas');
  expect(canvases.map((r) => r.id).sort()).toEqual([canvasId, imported.canvasId].sort());

  // Delete the original canvas
  await s.remove('canvas', canvasId);

  // Imported canvas and its mapped file still exist and are fully readable
  const remaining = await s.list('canvas');
  expect(remaining.map((r) => r.id)).toEqual([imported.canvasId]);
  const importedFileId = (remaining[0].value as Array<{ id: string }>)[0].id;
  expect([...await s.readFile(importedFileId)]).toEqual([1, 2, 3]);

  // Original file was deleted as expected
  await expect(s.readFile('source-file')).rejects.toMatchObject({ status: 404 });
});

test('exporting non-existent canvas or missing required media file throws clear errors', async () => {
  const { store: s } = await makeStore();

  await expect(exportProject(s, 'non-existent')).rejects.toMatchObject({ status: 404 });
  await expect(exportProject(s, '../bad-id')).rejects.toMatchObject({ status: 400 });

  // Canvas exists but item file missing
  const canvasId = 'canvas-1700000000000-00000000-0000-0000-0000-000000000002';
  await s.save('canvas', canvasId, [item('ghost-file')]);
  await expect(exportProject(s, canvasId)).rejects.toMatchObject({ status: 404 });
});

test('importing invalid or corrupted archives fails with descriptive StoreErrors', async () => {
  const { store: s } = await makeStore();

  await expect(importProject(s, new Uint8Array(0))).rejects.toMatchObject({ status: 400 });
  await expect(importProject(s, new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ status: 400 });

  // Missing manifest
  const noManifest = { 'files/x': new Uint8Array([1]) };
  const { zipSync } = await import('three/addons/libs/fflate.module.js');
  await expect(importProject(s, Uint8Array.from(zipSync(noManifest)))).rejects.toMatchObject({ status: 400 });

  // Unsafe entry path
  const unsafePath = {
    'manifest.json': new Uint8Array(Buffer.from(JSON.stringify({ format: 'lomra-project', canvas: [] }))),
    '../etc/passwd': new Uint8Array([1]),
  };
  await expect(importProject(s, Uint8Array.from(zipSync(unsafePath)))).rejects.toMatchObject({ status: 400 });
});

test('project archives round-trip local picture tools, imported SD and resize provenance', async () => {
  const { store } = await makeStore();
  const outputs = [
    { model: 'local-picture/birefnet-lite', prompt: 'Remove background' },
    { model: 'local-picture/realesrgan-x4v3', prompt: 'Upscale 2?' },
    { model: 'fal-ai/esrgan', prompt: 'Upscale 2?' },
    { model: 'fal-ai/birefnet/v2', prompt: 'Remove background' },
    { model: 'sd/local-checkpoint', prompt: 'Redraw', aspectRatio: '1:1', sd: { seed: 42, steps: 8, cfg: 1, image: true, strength: 0.6 } },
    { model: 'openrouter/image-model', prompt: 'Extend', aspectRatio: '16:9' },
  ].map((provenance, index) => ({ ...item(`output-${index}`), harness: { provenance } }));
  await Promise.all(outputs.map(output => store.writeFile(output.id, Uint8Array.of(42))));
  await store.save('canvas', 'default', outputs);
  const { archive } = await exportProject(store, 'default');
  const { canvasId } = await importProject(store, archive);
  const imported = (await store.list('canvas')).find(row => row.id === canvasId)?.value as typeof outputs;
  expect(imported.map(output => output.harness.provenance)).toEqual(outputs.map(output => output.harness.provenance));
});
