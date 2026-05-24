// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { FormData, fetch } from 'undici';

// eslint-disable-next-line import/no-unresolved
import { LarkImService } from './lark-im.service.js';

export interface LarkBitableConfig {
  openBase: string;
}

/**
 * Threshold above which we switch from upload_all (single-shot) to
 * upload_prepare/part/finish (chunked). Lark docs: 20 MB.
 */
const CHUNK_THRESHOLD = 20 * 1024 * 1024;
/** Lark docs say each chunk must be exactly 4 MB except the last. */
const CHUNK_SIZE = 4 * 1024 * 1024;

interface LarkResp<T> {
  code: number;
  msg: string;
  data?: T;
}

@Injectable()
export class LarkBitableService {
  private readonly logger = new Logger(LarkBitableService.name);

  constructor(
    private readonly im: LarkImService,
    private readonly cfg: LarkBitableConfig,
  ) {}

  /**
   * Update a record's fields in a bitable.
   * `fields` is a map of { 字段名: 值 }. For attachment fields, the value
   * should be an array of { file_token: "..." }.
   */
  async updateRecord(args: {
    appToken: string;
    tableId: string;
    recordId: string;
    fields: Record<string, unknown>;
  }): Promise<void> {
    const token = await this.im.getTenantAccessToken();
    const url =
      `${this.cfg.openBase}/open-apis/bitable/v1/apps/${args.appToken}` +
      `/tables/${args.tableId}/records/${args.recordId}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fields: args.fields }),
    });
    const body = (await res.json().catch(() => null)) as LarkResp<unknown> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`bitable updateRecord ${detail}`);
    }
  }

  /**
   * Upload a file to Lark drive as a bitable_file material.
   * Returns the file_token usable in a bitable attachment field.
   * Automatically chunks if buffer >= CHUNK_THRESHOLD.
   */
  async uploadMaterial(args: {
    parentNode: string; // bitable tableId
    fileName: string;
    fileBuffer: Buffer;
  }): Promise<string> {
    if (args.fileBuffer.length < CHUNK_THRESHOLD) {
      return this.uploadAll(args);
    }
    return this.uploadChunked(args);
  }

  // -------------- internal: small-file (single-shot) upload --------------

  private async uploadAll(args: {
    parentNode: string;
    fileName: string;
    fileBuffer: Buffer;
  }): Promise<string> {
    const token = await this.im.getTenantAccessToken();
    const form = new FormData();
    form.append('file_name', args.fileName);
    form.append('parent_type', 'bitable_file');
    form.append('parent_node', args.parentNode);
    form.append('size', String(args.fileBuffer.length));
    // Blob from Buffer — undici/Node 20+ supports passing Uint8Array.
    form.append(
      'file',
      new Blob([args.fileBuffer], { type: 'application/octet-stream' }),
      args.fileName,
    );
    const res = await fetch(`${this.cfg.openBase}/open-apis/drive/v1/medias/upload_all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = (await res.json().catch(() => null)) as LarkResp<{ file_token: string }> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`drive upload_all ${detail}`);
    }
    if (!body?.data?.file_token) throw new Error('drive upload_all missing file_token');
    return body.data.file_token;
  }

  // -------------- internal: large-file (chunked) upload --------------

  private async uploadChunked(args: {
    parentNode: string;
    fileName: string;
    fileBuffer: Buffer;
  }): Promise<string> {
    const token = await this.im.getTenantAccessToken();
    const size = args.fileBuffer.length;
    const blockNum = Math.ceil(size / CHUNK_SIZE);

    // 1. prepare
    const prepRes = await fetch(`${this.cfg.openBase}/open-apis/drive/v1/medias/upload_prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        file_name: args.fileName,
        parent_type: 'bitable_file',
        parent_node: args.parentNode,
        size,
        block_size: CHUNK_SIZE,
        block_num: blockNum,
      }),
    });
    if (!prepRes.ok) throw new Error(`drive upload_prepare http ${prepRes.status}`);
    const prep = (await prepRes.json()) as LarkResp<{ upload_id: string }>;
    if (prep.code !== 0) throw new Error(`drive upload_prepare code=${prep.code}: ${prep.msg}`);
    if (!prep.data?.upload_id) throw new Error('drive upload_prepare missing upload_id');
    const uploadId = prep.data.upload_id;

    // 2. part (each block)
    for (let seq = 0; seq < blockNum; seq += 1) {
      const start = seq * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, size);
      const chunk = args.fileBuffer.subarray(start, end);
      const form = new FormData();
      form.append('upload_id', uploadId);
      form.append('seq', String(seq));
      form.append('size', String(chunk.length));
      form.append(
        'file',
        new Blob([chunk], { type: 'application/octet-stream' }),
        `${args.fileName}.part${seq}`,
      );
      const partRes = await fetch(`${this.cfg.openBase}/open-apis/drive/v1/medias/upload_part`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!partRes.ok) throw new Error(`drive upload_part seq=${seq} http ${partRes.status}`);
      const part = (await partRes.json()) as LarkResp<unknown>;
      if (part.code !== 0)
        throw new Error(`drive upload_part seq=${seq} code=${part.code}: ${part.msg}`);
    }

    // 3. finish
    const finRes = await fetch(`${this.cfg.openBase}/open-apis/drive/v1/medias/upload_finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ upload_id: uploadId, block_num: blockNum }),
    });
    if (!finRes.ok) throw new Error(`drive upload_finish http ${finRes.status}`);
    const fin = (await finRes.json()) as LarkResp<{ file_token: string }>;
    if (fin.code !== 0) throw new Error(`drive upload_finish code=${fin.code}: ${fin.msg}`);
    if (!fin.data?.file_token) throw new Error('drive upload_finish missing file_token');
    return fin.data.file_token;
  }
}
