// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { FormData, fetch } from 'undici';

// eslint-disable-next-line import/no-unresolved
import { LarkImService } from './lark-im.service.js';

export interface LarkBotConfig {
  openBase: string;
}

interface LarkResp<T> {
  code: number;
  msg: string;
  data?: T;
}

@Injectable()
export class LarkBotService {
  private readonly logger = new Logger(LarkBotService.name);

  constructor(
    private readonly im: LarkImService,
    private readonly cfg: LarkBotConfig,
  ) {}

  /**
   * 发送一张 interactive 卡片到 chatId，返回飞书 message_id（用于后续 PATCH）
   */
  async sendCard(chatId: string, cardJson: object): Promise<string> {
    const token = await this.im.getTenantAccessToken();
    const url = `${this.cfg.openBase}/open-apis/im/v1/messages?receive_id_type=chat_id`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardJson),
      }),
    });
    const body = (await res.json().catch(() => null)) as LarkResp<{
      message_id: string;
    }> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`im sendCard ${detail}`);
    }
    if (!body?.data?.message_id) throw new Error('im sendCard missing message_id');
    return body.data.message_id;
  }

  /**
   * PATCH 已发卡片，更新 content。
   */
  async updateCard(messageId: string, cardJson: object): Promise<void> {
    const token = await this.im.getTenantAccessToken();
    const url = `${this.cfg.openBase}/open-apis/im/v1/messages/${messageId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content: JSON.stringify(cardJson),
      }),
    });
    const body = (await res.json().catch(() => null)) as LarkResp<unknown> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`im updateCard ${detail}`);
    }
  }

  /**
   * 上传文件到飞书 IM（msg_type=file 用），返回 file_key
   * fileType 取值参考飞书文档：pdf / doc / xls / ppt / mp4 / opus / stream
   */
  async uploadIMFile(buffer: Buffer, fileName: string, fileType: string): Promise<string> {
    const token = await this.im.getTenantAccessToken();
    const form = new FormData();
    form.append('file_type', fileType);
    form.append('file_name', fileName);
    form.append('file', new Blob([buffer], { type: 'application/octet-stream' }), fileName);
    const res = await fetch(`${this.cfg.openBase}/open-apis/im/v1/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = (await res.json().catch(() => null)) as LarkResp<{ file_key: string }> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`im uploadIMFile ${detail}`);
    }
    if (!body?.data?.file_key) throw new Error('im uploadIMFile missing file_key');
    return body.data.file_key;
  }

  /**
   * 发送富文本 @ 消息（用于完成时通知触发者）
   * text 里 <at> 标签由本方法包装在前缀。
   */
  async sendTextWithMention(args: {
    chatId: string;
    atOpenId: string;
    atName?: string;
    text: string;
  }): Promise<void> {
    const token = await this.im.getTenantAccessToken();
    const name = args.atName ?? '';
    const fullText = `<at user_id="${args.atOpenId}">${name}</at> ${args.text}`;
    const res = await fetch(
      `${this.cfg.openBase}/open-apis/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: args.chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: fullText }),
        }),
      },
    );
    const body = (await res.json().catch(() => null)) as LarkResp<unknown> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`im sendTextWithMention ${detail}`);
    }
  }

  /**
   * 发送 file 类型消息（push PDF 等附件到群/聊天）
   */
  async sendFileMessage(chatId: string, fileKey: string): Promise<void> {
    const token = await this.im.getTenantAccessToken();
    const res = await fetch(
      `${this.cfg.openBase}/open-apis/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'file',
          content: JSON.stringify({ file_key: fileKey }),
        }),
      },
    );
    const body = (await res.json().catch(() => null)) as LarkResp<unknown> | null;
    if (!res.ok || (body && body.code !== 0)) {
      const detail = body ? `code=${body.code} msg=${body.msg}` : `http ${res.status}`;
      throw new Error(`im sendFileMessage ${detail}`);
    }
  }
}
