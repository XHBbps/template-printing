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

/** 飞书机器人可见模板过滤:仅公共且已发布(防越权渲染他人/未发布模板)。 */
const BOT_TEMPLATE_WHERE = { visibility: 'public', publishedVersion: { not: null } } as const;

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

  // 飞书事件重推去重 — 5min 窗口内同 event_id 视为重复
  private readonly seenEventIds = new Map<string, number>();
  private readonly EVENT_DEDUP_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: LarkBotService,
    private readonly render: RenderService,
  ) {}

  /**
   * 机器人模板选择器的列表查询：仅返回「公共且已发布」的模板。
   * 避免飞书用户列出/选择并渲染他人的私有（即便已发布）模板。
   * 两处 picker（event 入口、card-action select）都必须走这里。
   */
  listBotTemplates(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.template.findMany({
      where: BOT_TEMPLATE_WHERE,
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /** 返回 true 表示首次见到（应处理）；false 表示重推（应跳过）*/
  private isFirstSeenEvent(eventId: string | undefined): boolean {
    if (!eventId) return true;
    const now = Date.now();
    // 清理过期
    for (const [k, t] of this.seenEventIds) {
      if (now - t > this.EVENT_DEDUP_TTL_MS) this.seenEventIds.delete(k);
    }
    if (this.seenEventIds.has(eventId)) return false;
    this.seenEventIds.set(eventId, now);
    return true;
  }

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

    // 4.1 event_id 去重：飞书响应慢时会重推同一 event
    if (!this.isFirstSeenEvent(ev.header.event_id)) {
      this.logger.log(`[diag] event ignored: duplicate event_id=${ev.header.event_id}`);
      return { ok: true };
    }

    const message = ev.event.message;
    const triggerOpenId = ev.event.sender.sender_id.open_id;
    const senderType = ev.event.sender.sender_type;

    // 5. 过滤：忽略机器人自己发的消息，避免"机器人收到自己消息又触发"回环
    // 飞书 sender_type 通常是 'user' / 'app' / 'anonymous' / 'chat'
    const botOpenId = process.env.LARK_BOT_OPEN_ID;
    if (senderType !== 'user') {
      this.logger.log(
        `[diag] event ignored: sender_type=${senderType} (not user, skip to avoid self-loop)`,
      );
      return { ok: true };
    }
    if (botOpenId && triggerOpenId === botOpenId) {
      this.logger.log('[diag] event ignored: sender open_id matches bot open_id');
      return { ok: true };
    }

    // 6. 群里要求 @ 机器人；私聊无条件触发
    if (message.chat_type === 'group') {
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
      const templates = await this.listBotTemplates();
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
    // URL challenge — 飞书后台配置卡片回调 URL 时也会发 url_verification（同 event endpoint）
    const challenge = EventChallenge.safeParse(raw);
    if (challenge.success) return { challenge: challenge.data.challenge };

    const parsed = CardActionBody.safeParse(raw);
    if (!parsed.success) {
      // 保留 — 飞书未来改 schema 时这条 warn 能直接定位
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

    // event_id 去重（卡片回调也可能被重推）
    const eventId = (body.header as { event_id?: string }).event_id;
    if (!this.isFirstSeenEvent(eventId)) {
      this.logger.log(`[diag] card-action ignored: duplicate event_id=${eventId}`);
      return { ok: true };
    }

    // sessionId/action 主路径来自 action.value；form submit 时 value 被吃掉，
    // 退化到从 name 解析（格式：<action>__<sessionId>）
    let sessionId = body.event.action.value?.sessionId;
    let action = body.event.action.value?.action;
    if ((!sessionId || !action) && body.event.action.name) {
      const m = /^([a-z_]+)__(.+)$/.exec(body.event.action.name);
      if (m) {
        action = action ?? m[1];
        sessionId = sessionId ?? m[2];
      }
    }
    if (!sessionId || !action) {
      this.logger.warn(
        `[diag] card-action missing sessionId/action: name=${body.event.action.name}`,
      );
      return { ok: true };
    }
    const session = await this.prisma.larkBotSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      // 过期 / 已删除 session — 静默
      return { ok: true };
    }

    // --- select_template + template_selected ---
    if (session.state === 'select_template' && action === 'template_selected') {
      const templateId = body.event.action.option;
      if (!templateId) return { toast: { type: 'error', content: '未选择模板' } };
      // 仅允许选择「公共且已发布」模板，防止越权渲染他人私有模板
      const tpl = await this.prisma.template.findFirst({
        where: { id: templateId, ...BOT_TEMPLATE_WHERE },
      });
      if (!tpl) return { toast: { type: 'error', content: '模板不可用或未发布' } };

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
      // 飞书新版 v2 callback：在响应里返回 card，飞书自动用它替换原卡片。
      // 不再依赖 PATCH messages API（PATCH 200 但客户端不刷新）。
      return {
        toast: { type: 'success', content: `已选「${tpl.name}」` },
        card: { type: 'raw', data: card },
      };
    }

    // --- fill_fields + submit_render ---
    // (field_change 不再使用 — form 容器在 submit 时打包所有字段到 action.form_value)
    if (session.state === 'fill_fields' && action === 'submit_render') {
      // 渲染前再次校验：仅「公共且已发布」可入队，防止越权渲染他人私有模板
      const tpl = session.templateId
        ? await this.prisma.template.findFirst({
            where: { id: session.templateId, ...BOT_TEMPLATE_WHERE },
          })
        : null;
      if (!tpl) return { toast: { type: 'error', content: '模板不可用或未发布' } };

      const fields = extractFields(tpl.data);
      // form_value 由飞书 form 容器在 submit 时打包；fallback 到 session.formData
      const formData =
        (body.event.action.form_value as Record<string, unknown> | undefined) ??
        (session.formData as Record<string, unknown>) ??
        {};
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
        const renderingCard = buildRenderingCard({ jobId, templateName: tpl.name });
        return {
          toast: { type: 'info', content: '已入队，渲染中…' },
          card: { type: 'raw', data: renderingCard },
        };
      } catch (e) {
        return { toast: { type: 'error', content: `入队失败：${(e as Error).message}` } };
      }
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
 * 从模板 data 中提取 schema 字段，转成 LarkBotCards 期望的 TemplateFieldMeta 数组。
 *
 * 兼容两种 schema 结构（设计器存的时候漏了 fields 包裹层，长期 bug）：
 *   - 老 zod 声明形态：{ schema: { fields: { fieldKey: FieldDef } } }
 *   - 设计器实际存形态：{ schema: { fieldKey: FieldDef } }  ← 多数模板是这个
 */
function extractFields(templateData: unknown): TemplateFieldMeta[] {
  if (!templateData || typeof templateData !== 'object') return [];
  const schema = (templateData as { schema?: Record<string, unknown> }).schema;
  if (!schema || typeof schema !== 'object') return [];

  // 先尝试 schema.fields；找不到则 fallback 到 schema 直接（设计器存的形态）
  const fieldsMap: Record<string, unknown> =
    schema.fields && typeof schema.fields === 'object'
      ? (schema.fields as Record<string, unknown>)
      : (schema as Record<string, unknown>);

  const result: TemplateFieldMeta[] = [];
  for (const [key, def] of Object.entries(fieldsMap)) {
    if (!def || typeof def !== 'object') continue;
    const d = def as {
      type?: string;
      label?: string;
      required?: boolean;
      example?: unknown;
      options?: Array<{ value: string; label: string }>;
    };
    // 跳过非字段定义键（safeguard：如果 schema 顶层混了其他属性）
    if (!d.type) continue;
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
