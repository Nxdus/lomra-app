import {
  BadRequestException,
  Controller,
  FileTypeValidator,
  HttpCode,
  Inject,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { TranscriptionService } from './transcription.service.js';

@Controller('transcriptions')
export class TranscriptionController {
  constructor(
    @Inject(TranscriptionService)
    private readonly transcription: TranscriptionService,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    }),
  )
  transcribe(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new FileTypeValidator({
            fileType: /^(audio\/|video\/webm$|application\/ogg$)/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (file.size === 0) {
      throw new BadRequestException('Audio file must not be empty');
    }
    return this.transcription.transcribe(file);
  }
}
