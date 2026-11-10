import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Express } from 'express';

@Injectable()
export class TranscriptionService {
  async transcribe(
    file: Express.Multer.File,
  ): Promise<{ text: string; language: string }> {
    const url = new URL(
      '/asr',
      process.env.WHISPER_URL ?? 'http://127.0.0.1:9000',
    );
    url.searchParams.set('task', 'transcribe');
    url.searchParams.set('output', 'json');
    // Omitting language lets Whisper detect it and preserve the original language.
    const body = new FormData();
    body.append(
      'audio_file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      'audio',
    );
    const signal = AbortSignal.timeout(300_000);

    try {
      const response = await fetch(url, { method: 'POST', body, signal });
      if (!response.ok) {
        throw new BadGatewayException('Whisper could not transcribe the audio');
      }
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('text' in result) ||
        typeof result.text !== 'string' ||
        !('language' in result) ||
        typeof result.language !== 'string'
      ) {
        throw new BadGatewayException(
          'Whisper returned an invalid transcription',
        );
      }
      return { text: result.text, language: result.language };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (signal.aborted)
        throw new GatewayTimeoutException('Whisper transcription timed out');
      throw new BadGatewayException(
        'Whisper is unavailable or returned an invalid response',
      );
    }
  }
}
