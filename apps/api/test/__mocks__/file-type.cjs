/* eslint-env node */
/**
 * CJS shim for file-type v19 (pure-ESM) — for use in Jest's CJS environment.
 *
 * file-type v19 is ESM-only and cannot be require()'d directly. Dynamic
 * import() also does not work inside jest's CJS vm context without
 * --experimental-vm-modules. This shim implements the two MIME types the
 * UploadsService actually needs (image/png, image/jpeg) via magic-byte
 * detection so the tests run without ESM plumbing.
 *
 * Production code (NestJS compiled/runtime) uses the real ESM package via
 * the standard `import` statement — this file is only loaded by Jest via
 * the `moduleNameMapper` entry in jest.config.cjs.
 */

'use strict';

// PNG magic: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// JPEG magic: FF D8 FF
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

// GIF magic: GIF8
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38]);

// WebP: RIFF????WEBP
const RIFF_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_MAGIC = Buffer.from([0x57, 0x45, 0x42, 0x50]);

/**
 * @param {Buffer | Uint8Array} input
 * @returns {Promise<{ext: string, mime: string} | undefined>}
 */
async function fileTypeFromBuffer(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);

  if (buf.length >= 8 && buf.slice(0, 8).equals(PNG_MAGIC)) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 3 && buf.slice(0, 3).equals(JPEG_MAGIC)) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buf.length >= 4 && buf.slice(0, 4).equals(GIF_MAGIC)) {
    return { ext: 'gif', mime: 'image/gif' };
  }
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).equals(RIFF_MAGIC) &&
    buf.slice(8, 12).equals(WEBP_MAGIC)
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return undefined;
}

module.exports = { fileTypeFromBuffer };
