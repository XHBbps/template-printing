// eslint-disable-next-line import/no-unresolved
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { FileInterceptor } from '@nestjs/platform-express';
// eslint-disable-next-line import/no-unresolved
import type { Express } from 'express';
// eslint-disable-next-line import/no-unresolved
import 'multer';

// eslint-disable-next-line import/no-unresolved
import { UploadsService } from './uploads.service.js';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file_missing');
    const allowed = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('mime_not_allowed');
    }
    return this.uploads.storeImage(file.buffer, file.mimetype);
  }
}
