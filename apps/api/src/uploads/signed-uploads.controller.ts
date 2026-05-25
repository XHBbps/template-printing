import { promises as fs } from 'fs';
import * as path from 'path';

import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UnauthorizedException,
  NotFoundException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
import type { Response } from 'express';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';

// eslint-disable-next-line import/no-unresolved
import { FileSigService } from './file-sig.service.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';
const RENDER_DIR = path.join(STORAGE_ROOT, 'render');

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
};

/**
 * GET /uploads/render/:filename?token=<hex>.<expiry>
 *
 * 校验 HMAC token，通过则返文件流；失败返 401（不是 404，避免泄露文件存在与否）。
 */
@Controller('uploads/render')
export class SignedUploadsController {
  constructor(private readonly fileSig: FileSigService) {}

  @Public()
  @Get(':filename')
  async serve(
    @Param('filename') filename: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // filename 安全校验：禁止路径穿越
    if (
      !filename ||
      filename.includes('/') ||
      filename.includes('..') ||
      filename.startsWith('.')
    ) {
      throw new NotFoundException('not_found');
    }
    if (!this.fileSig.verify(filename, token ?? null)) {
      throw new UnauthorizedException('invalid_or_expired_token');
    }
    const ext = path.extname(filename).slice(1).toLowerCase();
    const fullPath = path.join(RENDER_DIR, filename);
    // 防 path traversal: 解析后的路径必须以 RENDER_DIR 为前缀
    if (!path.resolve(fullPath).startsWith(path.resolve(RENDER_DIR))) {
      throw new NotFoundException('not_found');
    }
    try {
      await fs.access(fullPath);
    } catch {
      throw new NotFoundException('not_found');
    }
    const mime = MIME[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(fullPath);
  }
}
