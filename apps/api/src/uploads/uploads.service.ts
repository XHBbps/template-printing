import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

// eslint-disable-next-line import/no-unresolved
import { Injectable, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { fileTypeFromBuffer } from 'file-type';
// eslint-disable-next-line import/no-unresolved
import sharp from 'sharp';

// eslint-disable-next-line import/no-unresolved
import { sanitiseSvg } from './svg-sanitiser.js';

const MAX_BYTES = 5 * 1024 * 1024;
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';

export interface UploadResult {
  url: string;
  w_px: number;
  h_px: number;
  format: 'svg' | 'png' | 'jpeg';
  dpiWarning?: string;
}

@Injectable()
export class UploadsService {
  async storeImage(buffer: Buffer, mime: string): Promise<UploadResult> {
    if (buffer.length > MAX_BYTES) {
      throw new PayloadTooLargeException('image_too_large');
    }

    let cleaned: Buffer;
    let format: 'svg' | 'png' | 'jpeg';
    let w_px = 0;
    let h_px = 0;
    let dpiWarning: string | undefined;

    if (mime === 'image/svg+xml') {
      const sanitised = sanitiseSvg(buffer);
      if (!sanitised) throw new BadRequestException('svg_unsafe_or_invalid');
      cleaned = sanitised;
      format = 'svg';
      const text = sanitised.toString('utf8');
      const vb = text.match(/viewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*"/i);
      if (vb) {
        w_px = Math.round(Number(vb[1]));
        h_px = Math.round(Number(vb[2]));
      } else {
        const wm = text.match(/<svg[^>]*\swidth="(\d+)/i);
        const hm = text.match(/<svg[^>]*\sheight="(\d+)/i);
        w_px = wm ? Number(wm[1]) : 0;
        h_px = hm ? Number(hm[1]) : 0;
      }
    } else {
      const sniff = await fileTypeFromBuffer(buffer);
      if (!sniff) throw new BadRequestException('mime_unknown');
      if (sniff.mime !== mime) throw new BadRequestException('mime_mismatch');
      if (sniff.mime === 'image/png') {
        const out = await sharp(buffer).png().toBuffer({ resolveWithObject: true });
        cleaned = out.data;
        format = 'png';
        w_px = out.info.width;
        h_px = out.info.height;
        const meta = await sharp(buffer).metadata();
        if (meta.density && meta.density < 200)
          dpiWarning = `DPI ${meta.density} 偏低，打印可能模糊`;
      } else if (sniff.mime === 'image/jpeg') {
        const out = await sharp(buffer).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
        cleaned = out.data;
        format = 'jpeg';
        w_px = out.info.width;
        h_px = out.info.height;
        const meta = await sharp(buffer).metadata();
        if (meta.density && meta.density < 200)
          dpiWarning = `DPI ${meta.density} 偏低，打印可能模糊`;
      } else {
        throw new BadRequestException('mime_not_allowed');
      }
    }

    const ext = format === 'jpeg' ? 'jpg' : format;
    const hash = createHash('sha256').update(cleaned).digest('hex').slice(0, 16);
    const filename = `${hash}.${ext}`;
    const fullPath = path.join(STORAGE_ROOT, 'uploads', filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, cleaned);

    return { url: `/uploads/${filename}`, w_px, h_px, format, dpiWarning };
  }
}
