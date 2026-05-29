import { promises as fs } from 'fs';
import * as path from 'path';

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UnauthorizedException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import type { LarkBotSession } from '@prisma/client';
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

// eslint-disable-next-line import/no-unresolved
import { buildResultCard } from './lark-bot-cards.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from './lark-bot-dispatch.service.js';
// eslint-disable-next-line import/no-unresolved
import { fromHttpCardAction, fromHttpMessage } from './lark-bot-payload.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from './lark-bot.service.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';

// ---------------- Event payload schema ----------------

const EventChallenge = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
});

const EventEnvelope = z.object({
  schema: z.string().optional(),
  header: z
    .object({
      event_id: z.string().optional(),
      token: z.string(),
      event_type: z.string(),
      app_id: z.string().optional(),
      tenant_key: z.string().optional(),
    })
    .partial(),
  event: z.object({
    sender: z.object({
      sender_id: z.object({ open_id: z.string() }).passthrough(),
      sender_type: z.string().optional(),
    }),
    message: z.object({
      message_id: z.string(),
      chat_id: z.string(),
      chat_type: z.enum(['group', 'p2p']),
      message_type: z.string(),
      mentions: z
        .array(z.object({ id: z.object({ open_id: z.string() }).passthrough() }).passthrough())
        .optional(),
    }),
  }),
});

// 飞书新版卡片回调（schema 2.0）— event_type=card.action.trigger
// envelope 跟 im.message.receive_v1 一致：header.token + event.{...}
const CardActionBody = z.object({
  schema: z.string().optional(),
  header: z
    .object({
      token: z.string(),
      event_type: z.string().optional(),
      app_id: z.string().optional(),
    })
    .passthrough(),
  event: z.object({
    operator: z
      .object({
        open_id: z.string(),
      })
      .passthrough()
      .optional(),
    token: z.string().optional(),
    action: z.object({
      // 飞书 form_action_type=submit 时 value 不会传，但 name 会带（我们在 name 里编 sessionId）
      value: z.object({ sessionId: z.string(), action: z.string() }).passthrough().optional(),
      tag: z.string().optional(),
      option: z.string().optional(),
      input_value: z.string().optional(),
      name: z.string().optional(),
      form_value: z.record(z.unknown()).optional(),
    }),
  }),
});

const RenderCallbackDto = z.object({
  jobId: z.string(),
  status: z.enum(['done', 'failed']),
  pdfUrl: z.string().nullable().optional(),
  pngUrl: z.string().nullable().optional(),
  errorMsg: z.string().nullable().optional(),
});

// ---------------- Controller ----------------

@Controller('lark/bot')
export class LarkBotController {
  private readonly logger = new Logger(LarkBotController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: LarkBotService,
    private readonly dispatch: LarkBotDispatchService,
  ) {}

  // --------------------------------------------------------------
  // POST /lark/bot/event
  // 飞书事件订阅入口（含 url_verification challenge）
  // --------------------------------------------------------------
  @Public()
  @Post('event')
  @HttpCode(HttpStatus.OK)
  async event(@Body() raw: unknown): Promise<unknown> {
    // HTTP fallback:飞书已配长连接时此端点无人调用。保留以便长连接不可用时不改代码切回 webhook。
    // URL challenge — 飞书后台首次配置验证
    const challenge = EventChallenge.safeParse(raw);
    if (challenge.success) return { challenge: challenge.data.challenge };

    const parsed = EventEnvelope.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const ev = parsed.data;

    // verification token(HTTP 路径仍校验;WS 路径由握手期 app 凭证鉴权,不经此)
    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || ev.header.token !== expected) {
      throw new UnauthorizedException('verification_token_mismatch');
    }
    if (ev.header.event_type !== 'im.message.receive_v1') return { ok: true };

    await this.dispatch.handleMessageReceive(fromHttpMessage(ev));
    return { ok: true };
  }

  // --------------------------------------------------------------
  // POST /lark/bot/card-action
  // 卡片交互回调（用户选下拉 / 改输入 / 点按钮）
  // --------------------------------------------------------------
  @Public()
  @Post('card-action')
  @HttpCode(HttpStatus.OK)
  async cardAction(@Body() raw: unknown): Promise<unknown> {
    // HTTP fallback(同 event):飞书已配长连接时无人调用。保留作退路。
    const challenge = EventChallenge.safeParse(raw);
    if (challenge.success) return { challenge: challenge.data.challenge };

    const parsed = CardActionBody.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `[diag] CardActionBody parse failed (raw=${JSON.stringify(raw).slice(0, 400)}): ${JSON.stringify(parsed.error.flatten())}`,
      );
      throw new BadRequestException(parsed.error.flatten());
    }
    const body = parsed.data;

    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || body.header.token !== expected) {
      throw new UnauthorizedException('verification_token_mismatch');
    }

    return this.dispatch.handleCardAction(fromHttpCardAction(body));
  }

  // --------------------------------------------------------------
  // POST /lark/bot/render-callback?token=...
  // render worker 完成后回调
  // --------------------------------------------------------------
  @Public()
  @Post('render-callback')
  @HttpCode(HttpStatus.OK)
  async renderCallback(@Query('token') token: string, @Body() raw: unknown): Promise<{ ok: true }> {
    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('verification_token_mismatch');
    }
    const parsed = RenderCallbackDto.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const dto = parsed.data;

    const session = await this.prisma.larkBotSession.findUnique({
      where: { renderJobId: dto.jobId },
    });
    if (!session) return { ok: true };

    // P0：已成功 → 幂等短路，防重复上传/重发
    if (session.state === 'done') return { ok: true };

    const tpl = session.templateId
      ? await this.prisma.template.findUnique({ where: { id: session.templateId } })
      : null;
    const tplName = tpl?.name ?? '模板';

    if (dto.status === 'done' && dto.pdfUrl) {
      try {
        // worker 回调的 pdfUrl 带签名 query(?token=...);先去掉 query,否则文件名含 ?token → ENOENT。
        const cleanPath = dto.pdfUrl.split('?')[0] ?? '';
        const relative = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
        const filePath = path.join(STORAGE_ROOT, relative);
        // 防 path traversal: 解析后路径必须在 STORAGE_ROOT 内（+ sep 防 /storageEVIL 同前缀绕过）
        if (!path.resolve(filePath).startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
          throw new BadRequestException('invalid_pdf_path');
        }
        const buf = await fs.readFile(filePath);
        const fileKey = await this.bot.uploadIMFile(buf, `${tplName}.pdf`, 'pdf');

        // 顺序：先文件，再 @ 触发者 — 这样附件先到，再来通知
        await this.bot.sendFileMessage(session.chatId, fileKey);
        await this.bot.sendTextWithMention({
          chatId: session.chatId,
          atOpenId: session.triggerOpenId,
          text: `「${tplName}」渲染完成，请查收 PDF。`,
        });
        if (session.cardMessageId) {
          await this.bot.updateCard(
            session.cardMessageId,
            buildResultCard({ templateName: tplName, status: 'done' }),
          );
        }
        await this.prisma.larkBotSession.update({
          where: { id: session.id },
          data: { state: 'done', errorMsg: null },
        });
      } catch (e) {
        await this.markFailed(session, tplName, (e as Error).message);
      }
    } else {
      await this.markFailed(session, tplName, dto.errorMsg ?? 'render_failed');
    }
    return { ok: true };
  }

  // P9：复用调用方（renderCallback）已取的 session，免重复 findUnique。
  // chatId/triggerOpenId/cardMessageId 创建后不可变，调用方的副本与重查等价。
  private async markFailed(
    session: LarkBotSession,
    tplName: string,
    errorMsg: string,
  ): Promise<void> {
    try {
      await this.bot.sendTextWithMention({
        chatId: session.chatId,
        atOpenId: session.triggerOpenId,
        text: `「${tplName}」渲染失败：${errorMsg}`,
      });
      if (session.cardMessageId) {
        await this.bot.updateCard(
          session.cardMessageId,
          buildResultCard({ templateName: tplName, status: 'failed', errorMsg }),
        );
      }
    } catch (e) {
      this.logger.warn(`markFailed side-effect failed: ${(e as Error).message}`);
    }
    await this.prisma.larkBotSession.update({
      where: { id: session.id },
      data: { state: 'failed', errorMsg },
    });
  }
}
