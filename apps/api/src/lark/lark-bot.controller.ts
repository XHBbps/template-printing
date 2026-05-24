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
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';
// eslint-disable-next-line import/no-unresolved
import { RenderService } from '../render/render.service.js';

import {
  TemplateFieldMeta,
  buildFieldFormCard,
  buildRenderingCard,
  buildResultCard,
  buildSelectTemplateCard,
  // eslint-disable-next-line import/no-unresolved
} from './lark-bot-cards.js';
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

const CardActionBody = z.object({
  token: z.string(),
  open_id: z.string().optional(),
  open_message_id: z.string().optional(),
  action: z.object({
    value: z.object({ sessionId: z.string(), action: z.string() }).passthrough(),
    tag: z.string().optional(),
    option: z.string().optional(),
    input_value: z.string().optional(),
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
    private readonly render: RenderService,
  ) {}

  // --------------------------------------------------------------
  // POST /lark/bot/event
  // 飞书事件订阅入口（含 url_verification challenge）
  // --------------------------------------------------------------
  @Public()
  @Post('event')
  @HttpCode(HttpStatus.OK)
  async event(@Body() raw: unknown): Promise<unknown> {
    // 1. URL challenge — 飞书后台首次配置验证
    const challenge = EventChallenge.safeParse(raw);
    if (challenge.success) return { challenge: challenge.data.challenge };

    // 2. 解析事件 envelope
    const parsed = EventEnvelope.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const ev = parsed.data;

    // 3. verification token
    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || ev.header.token !== expected) {
      throw new UnauthorizedException('verification_token_mismatch');
    }

    // 4. 仅处理消息接收事件
    if (ev.header.event_type !== 'im.message.receive_v1') {
      return { ok: true };
    }

    const message = ev.event.message;
    const triggerOpenId = ev.event.sender.sender_id.open_id;

    // 5. 群里要求 @ 机器人；私聊无条件触发
    if (message.chat_type === 'group') {
      const botOpenId = process.env.LARK_BOT_OPEN_ID;
      if (!botOpenId) {
        this.logger.warn('LARK_BOT_OPEN_ID 未配置，群里 @ 检测被跳过 → 静默忽略群消息');
        return { ok: true };
      }
      const mentions = message.mentions ?? [];
      const botMentioned = mentions.some((m) => m.id.open_id === botOpenId);
      if (!botMentioned) return { ok: true };
    }

    // 6. re-@ 去重：同一 (chatId, triggerOpenId) 在 select/fill 状态时静默忽略
    const existing = await this.prisma.larkBotSession.findFirst({
      where: {
        chatId: message.chat_id,
        triggerOpenId,
        state: { in: ['select_template', 'fill_fields'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      this.logger.log(`re-@ ignored: existing session ${existing.id} in state ${existing.state}`);
      return { ok: true };
    }

    // 7. 创建新 session
    const session = await this.prisma.larkBotSession.create({
      data: {
        chatId: message.chat_id,
        chatType: message.chat_type,
        triggerOpenId,
        state: 'select_template',
      },
    });

    // 8. 拉模板列表 + 发卡片
    try {
      const templates = await this.prisma.template.findMany({
        select: { id: true, name: true },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      if (templates.length === 0) {
        await this.bot.sendTextWithMention({
          chatId: message.chat_id,
          atOpenId: triggerOpenId,
          text: '当前没有可用模板，请先在「模板打印平台」创建模板。',
        });
        await this.prisma.larkBotSession.update({
          where: { id: session.id },
          data: { state: 'failed', errorMsg: 'no_templates' },
        });
        return { ok: true };
      }
      const card = buildSelectTemplateCard({ sessionId: session.id, templates });
      const cardMessageId = await this.bot.sendCard(message.chat_id, card);
      await this.prisma.larkBotSession.update({
        where: { id: session.id },
        data: { cardMessageId },
      });
    } catch (e) {
      this.logger.error(`event handler send card failed: ${(e as Error).message}`);
      await this.prisma.larkBotSession.update({
        where: { id: session.id },
        data: { state: 'failed', errorMsg: (e as Error).message },
      });
    }

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
    const parsed = CardActionBody.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const body = parsed.data;

    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || body.token !== expected) {
      throw new UnauthorizedException('verification_token_mismatch');
    }

    const sessionId = body.action.value.sessionId;
    const action = body.action.value.action;
    const session = await this.prisma.larkBotSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      // 过期 / 已删除 session — 静默
      return { ok: true };
    }

    // --- select_template + template_selected ---
    if (session.state === 'select_template' && action === 'template_selected') {
      const templateId = body.action.option;
      if (!templateId) return { toast: { type: 'error', content: '未选择模板' } };
      const tpl = await this.prisma.template.findUnique({ where: { id: templateId } });
      if (!tpl) return { toast: { type: 'error', content: '模板已删除' } };

      await this.prisma.larkBotSession.update({
        where: { id: session.id },
        data: { templateId, state: 'fill_fields', formData: {} },
      });

      const fields = extractFields(tpl.data);
      const card = buildFieldFormCard({
        sessionId: session.id,
        templateName: tpl.name,
        fields,
        values: {},
      });
      if (session.cardMessageId) await this.bot.updateCard(session.cardMessageId, card);
      return { ok: true };
    }

    // --- fill_fields + field_change ---
    if (session.state === 'fill_fields' && action === 'field_change') {
      const fieldKey = body.action.value.fieldKey as string | undefined;
      if (!fieldKey) return { ok: true };
      const value = body.action.option ?? body.action.input_value ?? null;
      const next: Record<string, unknown> = {
        ...((session.formData as Record<string, unknown>) ?? {}),
        [fieldKey]: value,
      };
      await this.prisma.larkBotSession.update({
        where: { id: session.id },
        data: { formData: next as object },
      });
      return { ok: true };
    }

    // --- fill_fields + submit_render ---
    if (session.state === 'fill_fields' && action === 'submit_render') {
      const tpl = session.templateId
        ? await this.prisma.template.findUnique({ where: { id: session.templateId } })
        : null;
      if (!tpl) return { toast: { type: 'error', content: '模板已删除' } };

      const fields = extractFields(tpl.data);
      const formData = (session.formData as Record<string, unknown>) ?? {};
      const missing = fields.filter(
        (f) => f.required && (formData[f.key] === undefined || formData[f.key] === ''),
      );
      if (missing.length > 0) {
        return {
          toast: {
            type: 'error',
            content: `必填未填：${missing.map((m) => m.label).join('、')}`,
          },
        };
      }

      // 转换 boolean 字段 'true'/'false' → 实际 boolean
      const data: Record<string, unknown> = {};
      for (const f of fields) {
        const v = formData[f.key];
        if (v === undefined) continue;
        if (f.type === 'boolean') data[f.key] = v === 'true';
        else if (f.type === 'number' && typeof v === 'string') data[f.key] = Number(v);
        else data[f.key] = v;
      }

      const apiBase = process.env.API_INTERNAL_BASE ?? 'http://api:3000';
      const token = process.env.LARK_BOT_VERIFICATION_TOKEN ?? '';
      const callbackUrl = `${apiBase}/lark/bot/render-callback?token=${encodeURIComponent(token)}`;

      try {
        const { jobId } = await this.render.enqueue(null, {
          templateId: session.templateId!,
          data,
          formats: ['pdf'],
          callbackUrl,
        });
        await this.prisma.larkBotSession.update({
          where: { id: session.id },
          data: { renderJobId: jobId, state: 'rendering' },
        });
        if (session.cardMessageId) {
          await this.bot.updateCard(
            session.cardMessageId,
            buildRenderingCard({ jobId, templateName: tpl.name }),
          );
        }
      } catch (e) {
        return { toast: { type: 'error', content: `入队失败：${(e as Error).message}` } };
      }
      return { ok: true };
    }

    return { ok: true };
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

    const tpl = session.templateId
      ? await this.prisma.template.findUnique({ where: { id: session.templateId } })
      : null;
    const tplName = tpl?.name ?? '模板';

    if (dto.status === 'done' && dto.pdfUrl) {
      try {
        const relative = dto.pdfUrl.startsWith('/') ? dto.pdfUrl.slice(1) : dto.pdfUrl;
        const filePath = path.join(STORAGE_ROOT, relative);
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
        await this.markFailed(session.id, tplName, (e as Error).message);
      }
    } else {
      await this.markFailed(session.id, tplName, dto.errorMsg ?? 'render_failed');
    }
    return { ok: true };
  }

  private async markFailed(sessionId: string, tplName: string, errorMsg: string): Promise<void> {
    const session = await this.prisma.larkBotSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
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
      where: { id: sessionId },
      data: { state: 'failed', errorMsg },
    });
  }
}

// ---------------- helpers ----------------

/**
 * 从模板 data 中提取 schema.fields 数组（schema 内部是 {key: FieldDef} map，
 * 转成 LarkBotCards 期望的 TemplateFieldMeta 数组）。
 */
function extractFields(templateData: unknown): TemplateFieldMeta[] {
  if (!templateData || typeof templateData !== 'object') return [];
  const schema = (templateData as { schema?: { fields?: Record<string, unknown> } }).schema;
  if (!schema?.fields) return [];
  const result: TemplateFieldMeta[] = [];
  for (const [key, def] of Object.entries(schema.fields)) {
    if (!def || typeof def !== 'object') continue;
    const d = def as {
      type?: string;
      label?: string;
      required?: boolean;
      example?: unknown;
      options?: Array<{ value: string; label: string }>;
    };
    result.push({
      key,
      label: d.label ?? key,
      type: (d.type as TemplateFieldMeta['type']) ?? 'string',
      required: !!d.required,
      example: d.example,
      options: d.options,
    });
  }
  return result;
}
