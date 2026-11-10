import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TranscriptionModule } from '../src/transcription/transcription.module.js';

describe('Transcription API (e2e)', () => {
  let app: INestApplication;
  const fetchMock = vi.fn<typeof fetch>();
  const audio = Buffer.alloc(46);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(38, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(2, 40);

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('WHISPER_URL', 'http://whisper:9000');
    const module = await Test.createTestingModule({
      imports: [TranscriptionModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    { text: 'สวัสดีครับ', language: 'th' },
    { text: 'Hello', language: 'en' },
    { text: 'こんにちは', language: 'ja' },
  ])(
    'returns detected language $language without forcing translation',
    async (result) => {
      fetchMock.mockResolvedValue(Response.json(result));
      await request(app.getHttpServer())
        .post('/transcriptions')
        .attach('file', audio, 'speech.wav')
        .expect(200, result);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toEqual(
        new URL('http://whisper:9000/asr?task=transcribe&output=json'),
      );
      const body = options?.body;
      const uploaded = (body as FormData).get('audio_file') as File;
      expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(audio);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it('rejects missing, empty and non-audio files without contacting Whisper', async () => {
    await request(app.getHttpServer()).post('/transcriptions').expect(400);
    await request(app.getHttpServer())
      .post('/transcriptions')
      .attach('file', Buffer.alloc(0), 'empty.wav')
      .expect(400);
    await request(app.getHttpServer())
      .post('/transcriptions')
      .attach('file', Buffer.from('not audio'), {
        filename: 'fake.wav',
        contentType: 'audio/wav',
      })
      .expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects files above 25 MiB before contacting Whisper', async () => {
    await request(app.getHttpServer())
      .post('/transcriptions')
      .attach('file', Buffer.alloc(25 * 1024 * 1024 + 1), 'large.wav')
      .expect(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    new Response('internal details', { status: 500 }),
    new Response('not json'),
    Response.json({ text: 'missing language' }),
  ])('maps upstream failures or invalid responses to 502', async (response) => {
    fetchMock.mockResolvedValue(response);
    const result = await request(app.getHttpServer())
      .post('/transcriptions')
      .attach('file', audio, 'speech.wav')
      .expect(502);
    expect(JSON.stringify(result.body)).not.toContain('internal details');
  });

  it('returns 502 when Whisper is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await request(app.getHttpServer())
      .post('/transcriptions')
      .attach('file', audio, 'speech.wav')
      .expect(502);
  });

  it('returns 504 when the transcription times out', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.abort());
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await request(app.getHttpServer())
      .post('/transcriptions')
      .attach('file', audio, 'speech.wav')
      .expect(504);
    expect(timeout).toHaveBeenCalledWith(300_000);
  });
});
