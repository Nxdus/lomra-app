import { expect, test } from 'bun:test';
import { createWhisperServer, decodeWav } from './whisper.mjs';

function wav(samples, { rate = 16000, channels = 1 } = {}) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, i) => { bytes[offset + i] = char.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return bytes;
}

test('decodeWav returns mono 16 kHz samples', () => {
  expect([...decodeWav(wav([16384, -16384, 0]))]).toEqual([0.5, -0.5, 0]);
  expect([...decodeWav(wav([16384, 0, -16384, 0], { channels: 2 }))]).toEqual([0.25, -0.25]);
  expect(decodeWav(wav(new Array(480).fill(100), { rate: 48000 })).length).toBe(160);
  expect(() => decodeWav(new Uint8Array([1, 2, 3]))).toThrow('WAV');
});

test('the server transcribes uploaded WAV audio, picks models and reports readiness and bad input', async () => {
  let state = 'missing';
  const downloads = [];
  const received = [];
  const server = createWhisperServer({
    prepare: async (model) => model === 'nope' ? 'unknown' : state,
    download: (model) => { downloads.push(model); state = 'loading'; },
    info: () => ({ downloading: null }),
    transcribe: async (samples, model) => { received.push([samples.length, model]); return { text: ' สวัสดี ', language: 'th' }; },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = (bytes, query = '') => {
    const body = new FormData();
    body.append('audio_file', new File([bytes], 'audio'));
    return fetch(`${base}/asr?task=transcribe${query}`, { method: 'POST', body });
  };
  try {
    expect((await upload(wav([1, 2, 3]))).status).toBe(409);
    expect((await fetch(`${base}/download?model=base`, { method: 'POST' })).status).toBe(202);
    expect(downloads).toEqual(['base']);
    expect((await fetch(`${base}/download?model=nope`, { method: 'POST' })).status).toBe(400);
    expect((await upload(wav([1, 2, 3]))).status).toBe(503);
    state = 'ready';
    const ok = await upload(wav([1, 2, 3]), '&model=base');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ text: 'สวัสดี', language: 'th' });
    expect(received).toEqual([[3, 'base']]);
    expect((await upload(wav([1]), '&model=nope')).status).toBe(400);
    expect((await upload(new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await fetch(`${base}/asr`, { method: 'POST', body: 'nope' })).status).toBe(400);
    expect(await (await fetch(`${base}/status`)).json()).toEqual({ downloading: null });
    expect((await fetch(`${base}/other`, { method: 'POST' })).status).toBe(404);
  } finally {
    server.close();
  }
});
