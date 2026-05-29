// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';
// eslint-disable-next-line import/no-unresolved
import { RenderService } from '../render/render.service.js';

import {
  buildFieldFormCard,
  buildRenderingCard,
  buildSelectTemplateCard,
  extractFields,
  // eslint-disable-next-line import/no-unresolved
} from './lark-bot-cards.js';
import type { NormalizedCardAction, NormalizedMessageEvent } from './lark-bot-payload.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from './lark-bot.service.js';

/** 飞书机器人可见模板过滤:仅公共且已发布(防越权渲染他人/未发布模板)。 */
const BOT_TEMPLATE_WHERE = { visibility: 'public', publishedVersion: { not: null } } as const;

/**
 * bot 事件 + 卡片回调的纯业务处理(脱离传输层)。WS 长连接(LarkBotWsService)与
 * HTTP fallback(LarkBotController)两入口各自把自己的 payload 归一化后调这里。
 * 业务逻辑迁自原 LarkBotController.event() / cardAction()。
 */
@Injectable()
export class LarkBotDispatchService {
  private readonly logger = new Logger(LarkBotDispatchService.name);

  // 飞书事件重推去重 — 5min 窗口内同 event_id 视为重复(进程内,单实例)
  private readonly seenEventIds = new Map<string, number>();
  private readonly EVENT_DEDUP_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: LarkBotService,
    private readonly render: RenderService,
  ) {}

  /** 仅返回「公共且已发布」模板,防止越权列出/渲染他人私有模板。 */
  listBotTemplates(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.template.findMany({
      where: BOT_TEMPLATE_WHERE,
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /** 返回 true=首次见到(应处理);false=重推(应跳过)。 */
  private isFirstSeenEvent(eventId: string | undefined): boolean {
    if (!eventId) return true;
    const now = Date.now();
    for (const [k, t] of this.seenEventIds) {
      if (now - t > this.EVENT_DEDUP_TTL_MS) this.seenEventIds.delete(k);
    }
    if (this.seenEventIds.has(eventId)) return false;
    this.seenEventIds.set(eventId, now);
    return true;
  }

  /** im.message.receive_v1 → 建会话 + 发选择卡。字段来自归一化 payload。 */
  async handleMessageReceive(p: NormalizedMessageEvent): Promise<void> {
    if (!this.isFirstSeenEvent(p.eventId)) {
      this.logger.log(`[diag] event ignored: duplicate event_id=${p.eventId}`);
      return;
    }
    const botOpenId = process.env.LARK_BOT_OPEN_ID;
    // 忽略机器人自己发的消息,避免自回环
    if (p.senderType !== 'user') return;
    if (botOpenId && p.senderOpenId === botOpenId) return;
    // 群里要求 @ 机器人;私聊无条件触发
    if (p.message.chatType === 'group') {
      if (!botOpenId) {
        this.logger.warn('LARK_BOT_OPEN_ID 未配置,群 @ 检测跳过 → 忽略群消息');
        return;
      }
      if (!p.message.mentions.includes(botOpenId)) return;
    }
    // re-@ 去重:同一 (chatId, triggerOpenId) 在 select/fill 状态时静默忽略
    const existing = await this.prisma.larkBotSession.findFirst({
      where: {
        chatId: p.message.chatId,
        triggerOpenId: p.senderOpenId,
        state: { in: ['select_template', 'fill_fields'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      this.logger.log(`re-@ ignored: existing session ${existing.id} in state ${existing.state}`);
      return;
    }
    const session = await this.prisma.larkBotSession.create({
      data: {
        chatId: p.message.chatId,
        chatType: p.message.chatType,
        triggerOpenId: p.senderOpenId,
        state: 'select_template',
      },
    });
    try {
      const templates = await this.listBotTemplates();
      if (templates.length === 0) {
        await this.bot.sendTextWithMention({
          chatId: p.message.chatId,
          atOpenId: p.senderOpenId,
          text: '当前没有可用模板,请先在「模板打印平台」创建模板。',
        });
        await this.prisma.larkBotSession.update({
          where: { id: session.id },
          data: { state: 'failed', errorMsg: 'no_templates' },
        });
        return;
      }
      const card = buildSelectTemplateCard({ sessionId: session.id, templates });
      const cardMessageId = await this.bot.sendCard(p.message.chatId, card);
      await this.prisma.larkBotSession.update({
        where: { id: session.id },
        data: { cardMessageId },
      });
    } catch (e) {
      this.logger.error(`handleMessageReceive send card failed: ${(e as Error).message}`);
      await this.prisma.larkBotSession.update({
        where: { id: session.id },
        data: { state: 'failed', errorMsg: (e as Error).message },
      });
    }
  }

  /** card.action.trigger → 状态机分派;返回 {toast,card} 或 {ok:true}。整段 try/catch 防 handler 抛错。 */
  async handleCardAction(p: NormalizedCardAction): Promise<unknown> {
    try {
      // event_id 去重(卡片回调也可能被重推)
      if (!this.isFirstSeenEvent(p.eventId)) {
        this.logger.log(`[diag] card-action ignored: duplicate event_id=${p.eventId}`);
        return { ok: true };
      }
      // sessionId/action 主路径来自 action.value;form submit 时 value 被吃掉,
      // 退化到从 name 解析(格式:<action>__<sessionId>)
      let sessionId = p.action.value?.sessionId;
      let action = p.action.value?.action;
      if ((!sessionId || !action) && p.action.name) {
        const m = /^([a-z_]+)__(.+)$/.exec(p.action.name);
        if (m) {
          action = action ?? m[1];
          sessionId = sessionId ?? m[2];
        }
      }
      if (!sessionId || !action) {
        this.logger.warn(`[diag] card-action missing sessionId/action: name=${p.action.name}`);
        return { ok: true };
      }
      const session = await this.prisma.larkBotSession.findUnique({ where: { id: sessionId } });
      if (!session) return { ok: true };

      // --- select_template + template_selected ---
      if (session.state === 'select_template' && action === 'template_selected') {
        const templateId = p.action.option;
        if (!templateId) return { toast: { type: 'error', content: '未选择模板' } };
        // 仅允许「公共且已发布」,防越权渲染他人私有模板
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
        // 新版 v2 callback:响应里返回 card,飞书自动替换原卡片。
        return {
          toast: { type: 'success', content: `已选「${tpl.name}」` },
          card: { type: 'raw', data: card },
        };
      }

      // --- fill_fields + submit_render ---
      if (session.state === 'fill_fields' && action === 'submit_render') {
        const tpl = session.templateId
          ? await this.prisma.template.findFirst({
              where: { id: session.templateId, ...BOT_TEMPLATE_WHERE },
            })
          : null;
        if (!tpl) return { toast: { type: 'error', content: '模板不可用或未发布' } };
        const fields = extractFields(tpl.data);
        // form_value 由飞书 form 容器在 submit 时打包;fallback 到 session.formData
        const formData =
          (p.action.formValue as Record<string, unknown> | undefined) ??
          (session.formData as Record<string, unknown>) ??
          {};
        const missing = fields.filter(
          (f) => f.required && (formData[f.key] === undefined || formData[f.key] === ''),
        );
        if (missing.length > 0) {
          return {
            toast: { type: 'error', content: `必填未填:${missing.map((m) => m.label).join('、')}` },
          };
        }
        // 转换 boolean/number/日期 字段
        const data: Record<string, unknown> = {};
        for (const f of fields) {
          const v = formData[f.key];
          if (v === undefined) continue;
          if (f.type === 'boolean') data[f.key] = v === 'true';
          else if (f.type === 'number' && typeof v === 'string') data[f.key] = Number(v);
          else if ((f.type === 'date' || f.type === 'datetime') && typeof v === 'string') {
            // 飞书 date_picker 返回如 "2026-05-29 +0800";去掉尾部时区偏移,date 只留 YYYY-MM-DD。
            data[f.key] = v.replace(/\s*[+-]\d{2}:?\d{2}$/, '').trim();
          } else data[f.key] = v;
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
          return {
            toast: { type: 'info', content: '已入队,渲染中…' },
            card: { type: 'raw', data: buildRenderingCard({ jobId, templateName: tpl.name }) },
          };
        } catch (e) {
          return { toast: { type: 'error', content: `入队失败:${(e as Error).message}` } };
        }
      }

      return { ok: true };
    } catch (e) {
      this.logger.error(`handleCardAction error: ${(e as Error).message}`);
      return { toast: { type: 'error', content: '处理失败,请重试' } };
    }
  }
}
