import { createServer } from 'node:http';
import { Readable } from 'node:stream';

const SAMPLE_RATE = 16000;
const MAX_BYTES = 26 * 1024 * 1024;

/** Decode a 16-bit PCM or 32-bit float WAV to mono Float32 samples at 16 kHz, the input Whisper expects. */
export function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Expected a WAV file');
  let format, channels, rate, bits, start, end;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (tag(offset) === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (tag(offset) === 'data') {
      start = body;
      end = Math.min(body + size, bytes.length);
      break;
    }
    offset = body + size + (size & 1);
  }
  const pcm = format === 1 && bits === 16;
  if (!(pcm || (format === 3 && bits === 32)) || !channels || !rate || start === undefined) throw new Error('Unsupported WAV format');
  const width = bits / 8;
  const frames = Math.floor((end - start) / (width * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = start + (i * channels + c) * width;
      sum += pcm ? view.getInt16(at, true) / 32768 : view.getFloat32(at, true);
    }
    mono[i] = sum / channels;
  }
  if (rate === SAMPLE_RATE) return mono;
  const out = new Float32Array(Math.floor(frames * SAMPLE_RATE / rate));
  for (let i = 0; i < out.length; i++) {
    const position = i * rate / SAMPLE_RATE;
    const index = Math.floor(position);
    out[i] = mono[index] + ((mono[index + 1] ?? mono[index]) - mono[index]) * (position - index);
  }
  return out;
}

/**
 * A small HTTP server that speaks the `/asr` subset of whisper-asr-webservice, so the
 * app's transcription route works unchanged against it. Requests may pick a model with `?model=`.
 * `prepare(model)` resolves 'ready', 'loading' (downloading), 'missing' (not downloaded) or 'unknown';
 * `transcribe(samples, model)` returns `{ text, language }`; `POST /download?model=` calls `download(model)`;
 * `GET /status` returns `info()`.
 */
export function createWhisperServer({ transcribe, prepare, download, info }) {
  let queue = Promise.resolve();
  const reply = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  return createServer(async (request, response) => {
    try {
      const { pathname, searchParams } = new URL(request.url, 'http://local');
      const model = searchParams.get('model') ?? undefined;
      if (request.method === 'GET' && pathname === '/status') return reply(response, 200, info());
      if (request.method === 'POST' && pathname === '/download') {
        if (await prepare(model) === 'unknown') return reply(response, 400, { message: 'Unknown speech model' });
        download(model);
        return reply(response, 202, {});
      }
      if (request.method !== 'POST' || pathname !== '/asr') return reply(response, 404, { message: 'Not found' });
      const state = await prepare(model);
      if (state === 'unknown') return reply(response, 400, { message: 'Unknown speech model' });
      if (state === 'missing') return reply(response, 409, { message: 'The speech model is not downloaded' });
      if (state === 'loading') return reply(response, 503, { message: 'The speech model is still loading' });
      if (Number(request.headers['content-length'] ?? 0) > MAX_BYTES) return reply(response, 413, { message: 'Audio is too large' });
      const form = await new Request('http://local/asr', {
        method: 'POST', headers: request.headers, body: Readable.toWeb(request), duplex: 'half',
      }).formData().catch(() => undefined);
      if (!form) return reply(response, 400, { message: 'Expected a multipart audio upload' });
      const file = form.get('audio_file');
      if (!(file instanceof File) || !file.size) return reply(response, 400, { message: 'audio_file is required' });
      let samples;
      try { samples = decodeWav(new Uint8Array(await file.arrayBuffer())); } catch (cause) { return reply(response, 400, { message: cause.message }); }
      const run = queue.then(() => transcribe(samples, model));
      queue = run.catch(() => {});
      const { text, language } = await run;
      reply(response, 200, { text: text.trim(), language });
    } catch (cause) {
      console.error('whisper request failed', cause);
      if (!response.headersSent) reply(response, 500, { message: 'Transcription failed' });
    }
  });
}
