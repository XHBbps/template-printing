# 飞书 bot 长连接(WebSocket)接管事件+卡片回调 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让飞书 bot 的事件订阅(`im.message.receive_v1`)与卡片回调(`card.action.trigger`)经 `@larksuiteoapi/node-sdk` 的 WSClient 长连接接收;现有 HTTP 端点保留为 fallback。

**Architecture:** 抽 `LarkBotDispatchService`(纯业务,收**归一化 payload**)+ `LarkBotWsService`(薄 WS 胶水,受 env 门控)。WS 与 HTTP 两入口各自把自己的 payload 形态适配成归一化结构后调同一 dispatch。多维表格 print-trigger / 内部 render-callback 不动。

**Tech Stack:** NestJS 10 / TypeScript(ESM,`.js` import 后缀)/ `@larksuiteoapi/node-sdk@1.40.0`(已是依赖)/ jest。

**设计依据:** `docs/superpowers/specs/2026-05-29-lark-bot-longconn-design.md`。务必先读,尤其 §2.1(SDK `parse()` 把 header+event 扁平化到顶层 → handler 收到的 `targetData` 字段路径与 HTTP body 不同)。

**测试运行(本地裸机):** `cd apps/api && DATABASE_URL='postgres://postgres:postgres@localhost:6432/template_printing' REDIS_URL='redis://localhost:6479' npx jest --config jest.config.cjs --runInBand --forceExit <file>`(纯单测不需要 DB,但 boot AppModule 的会需要)。

---

## File Structure

- **新增** `apps/api/src/lark/lark-bot-payload.ts` — 归一化 payload 类型 + 4 个适配函数(WS/HTTP × message/card)。
- **新增** `apps/api/src/lark/lark-bot-dispatch.service.ts` — 纯业务:`handleMessageReceive` / `handleCardAction` + 去重 Map + `listBotTemplates`(从 controller 迁入)。
- **新增** `apps/api/src/lark/lark-bot-ws.service.ts` — WSClient 生命周期胶水。
- **改** `apps/api/src/lark/lark-bot.controller.ts` — 瘦身:event/card-action 改为"校验+适配→调 dispatch"的薄壳;render-callback 不动。
- **改** `apps/api/src/lark/lark.module.ts` — 注册两个新 provider。
- **改** `apps/api/src/app-bootstrap.ts` — 加 `app.enableShutdownHooks()`。
- **改** `apps/api/src/common/env.ts` — 加 `LARK_BOT_LONG_CONN_ENABLED` + 调整批次5 跨字段断言。
- **改** `.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`。
- **新增** `apps/api/test/lark-bot-dispatch.spec.ts`、`apps/api/test/lark-bot-ws-gating.spec.ts`、`apps/api/test/lark-bot-payload.spec.ts`。
- **文档** PROGRESS / deployment / PRE_DEPLOYMENT_CHECKLIST / examples/lark-bot/README。

---

### Task 1: 归一化 payload 类型 + 适配函数

**Files:**
- Create: `apps/api/src/lark/lark-bot-payload.ts`
- Test: `apps/api/test/lark-bot-payload.spec.ts`

- [ ] **Step 1: 写失败测试**

`apps/api/test/lark-bot-payload.spec.ts`:
```ts
import { describe, it, expect } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import {
  fromWsMessage,
  fromHttpMessage,
  fromWsCardAction,
  fromHttpCardAction,
} from '../src/lark/lark-bot-payload.js';

// SDK parse() 对 v2 事件把 header+event 扁平化到顶层(见 spec §2.1)
const wsMessage = {
  schema: '2.0',
  event_id: 'evt-1',
  token: 'tok',
  event_type: 'im.message.receive_v1',
  sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
  message: {
    message_id: 'om_1',
    chat_id: 'oc_1',
    chat_type: 'p2p',
    message_type: 'text',
    mentions: [{ id: { open_id: 'ou_bot' } }],
  },
};
const httpMessage = {
  schema: '2.0',
  header: { event_id: 'evt-1', token: 'tok', event_type: 'im.message.receive_v1' },
  event: {
    sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'text',
      mentions: [{ id: { open_id: 'ou_bot' } }],
    },
  },
};

describe('lark-bot-payload adapters', () => {
  it('WS 扁平 与 HTTP 嵌套 的 message 事件归一化到同一结构', () => {
    const a = fromWsMessage(wsMessage);
    const b = fromHttpMessage(httpMessage);
    expect(a).toEqual(b);
    expect(a.eventId).toBe('evt-1');
    expect(a.senderOpenId).toBe('ou_user');
    expect(a.senderType).toBe('user');
    expect(a.message.chatId).toBe('oc_1');
    expect(a.message.chatType).toBe('p2p');
    expect(a.message.mentions).toEqual(['ou_bot']);
  });

  it('card action:WS 扁平 与 HTTP 嵌套 归一化一致', () => {
    const ws = {
      schema: '2.0',
      event_id: 'evt-2',
      operator: { open_id: 'ou_op' },
      action: { value: { sessionId: 's1', action: 'template_selected' }, option: 'tpl-1' },
    };
    const http = {
      schema: '2.0',
      header: { event_id: 'evt-2' },
      event: {
        operator: { open_id: 'ou_op' },
        action: { value: { sessionId: 's1', action: 'template_selected' }, option: 'tpl-1' },
      },
    };
    expect(fromWsCardAction(ws)).toEqual(fromHttpCardAction(http));
    expect(fromWsCardAction(ws).action.value).toEqual({ sessionId: 's1', action: 'template_selected' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx jest --config jest.config.cjs --runInBand --forceExit test/lark-bot-payload.spec.ts`
Expected: FAIL —「Cannot find module ... lark-bot-payload.js」。

- [ ] **Step 3: 写实现**

`apps/api/src/lark/lark-bot-payload.ts`:
```ts
// 归一化 payload:WS(SDK parse 后扁平 targetData)与 HTTP(原始 {header,event})两形态各自映射到此。
// 见 docs/superpowers/specs/2026-05-29-lark-bot-longconn-design.md §2.1。

export interface NormalizedMessageEvent {
  eventId?: string;
  senderOpenId: string;
  senderType?: string;
  message: {
    messageId: string;
    chatId: string;
    chatType: 'group' | 'p2p';
    messageType: string;
    mentions: string[]; // mention 的 open_id 列表
  };
}

export interface NormalizedCardAction {
  eventId?: string;
  operatorOpenId?: string;
  action: {
    value?: { sessionId?: string; action?: string };
    name?: string;
    option?: string;
    inputValue?: string;
    formValue?: Record<string, unknown>;
  };
}

interface RawMessage {
  message_id: string;
  chat_id: string;
  chat_type: 'group' | 'p2p';
  message_type: string;
  mentions?: Array<{ id?: { open_id?: string } }>;
}
interface RawSender {
  sender_id?: { open_id?: string };
  sender_type?: string;
}
interface RawAction {
  value?: { sessionId?: string; action?: string };
  name?: string;
  option?: string;
  input_value?: string;
  form_value?: Record<string, unknown>;
}

function normMessage(sender: RawSender | undefined, message: RawMessage, eventId?: string): NormalizedMessageEvent {
  return {
    eventId,
    senderOpenId: sender?.sender_id?.open_id ?? '',
    senderType: sender?.sender_type,
    message: {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType: message.chat_type,
      messageType: message.message_type,
      mentions: (message.mentions ?? [])
        .map((m) => m.id?.open_id)
        .filter((x): x is string => typeof x === 'string'),
    },
  };
}

function normAction(operator: { open_id?: string } | undefined, action: RawAction, eventId?: string): NormalizedCardAction {
  return {
    eventId,
    operatorOpenId: operator?.open_id,
    action: {
      value: action.value,
      name: action.name,
      option: action.option,
      inputValue: action.input_value,
      formValue: action.form_value,
    },
  };
}

// ---- WS:SDK parse() 把 header+event 扁平化到顶层 ----
export function fromWsMessage(d: Record<string, unknown>): NormalizedMessageEvent {
  return normMessage(
    d.sender as RawSender,
    d.message as RawMessage,
    d.event_id as string | undefined,
  );
}
export function fromWsCardAction(d: Record<string, unknown>): NormalizedCardAction {
  return normAction(
    d.operator as { open_id?: string } | undefined,
    d.action as RawAction,
    d.event_id as string | undefined,
  );
}

// ---- HTTP:原始 {header, event} ----
export function fromHttpMessage(b: { header?: { event_id?: string }; event: { sender?: RawSender; message: RawMessage } }): NormalizedMessageEvent {
  return normMessage(b.event.sender, b.event.message, b.header?.event_id);
}
export function fromHttpCardAction(b: { header?: { event_id?: string }; event: { operator?: { open_id?: string }; action: RawAction } }): NormalizedCardAction {
  return normAction(b.event.operator, b.event.action, b.header?.event_id);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx jest --config jest.config.cjs --runInBand --forceExit test/lark-bot-payload.spec.ts`
Expected: PASS(2 个用例)。同时 `npx tsc --noEmit` 通过。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/lark/lark-bot-payload.ts apps/api/test/lark-bot-payload.spec.ts
git commit -m "feat(lark): bot payload 归一化适配(WS 扁平 / HTTP 嵌套)"
```

---

### Task 2: `LarkBotDispatchService`(迁入业务逻辑,改用归一化 payload)

**Files:**
- Create: `apps/api/src/lark/lark-bot-dispatch.service.ts`
- Modify: `apps/api/src/lark/lark-bot.controller.ts`(迁出 `event`/`cardAction` 业务体、`seenEventIds`/`isFirstSeenEvent`/`listBotTemplates`、`extractFields` 引用、`BOT_TEMPLATE_WHERE` 等共享常量)

**说明:** 业务逻辑**原样迁移**自 controller 的 `event()`(当前 L194-276,即 challenge+token 之后的部分)与 `cardAction()`(当前 L306-430,即 challenge+token 之后的部分),**仅把字段访问换成归一化 payload**。字段替换映射:

| 原 controller(HTTP body) | 归一化 payload |
|---|---|
| `ev.header.event_id` | `p.eventId` |
| `ev.event.message`(对象) | `p.message`(注意子字段改驼峰:`chat_id`→`chatId`、`chat_type`→`chatType`、`message_id`→`messageId`) |
| `ev.event.sender.sender_id.open_id` | `p.senderOpenId` |
| `ev.event.sender.sender_type` | `p.senderType` |
| `message.mentions.some((m)=>m.id.open_id===botOpenId)` | `p.message.mentions.includes(botOpenId)` |
| `body.header.event_id` | `p.eventId` |
| `body.event.action.value?.sessionId/action` | `p.action.value?.sessionId/action` |
| `body.event.action.name` | `p.action.name` |
| `body.event.action.option` | `p.action.option` |
| `body.event.action.form_value` | `p.action.formValue` |

- [ ] **Step 1: 写失败测试(占位)**

先建空 service 让后续 Task 3 的测试有目标。`apps/api/src/lark/lark-bot-dispatch.service.ts` 暂写签名(下一步填实现);本步只创建文件骨架并 `tsc`。

- [ ] **Step 2: 写实现(迁移 + 改字段)**

`apps/api/src/lark/lark-bot-dispatch.service.ts`:
```ts
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
  // extractFields 当前在 controller 里;若是本地函数,连同迁入本文件或抽到 lark-bot-cards
  // eslint-disable-next-line import/no-unresolved
} from './lark-bot-cards.js';
import type { NormalizedCardAction, NormalizedMessageEvent } from './lark-bot-payload.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from './lark-bot.service.js';

const BOT_TEMPLATE_WHERE = { visibility: 'public', publishedVersion: { not: null } } as const;

@Injectable()
export class LarkBotDispatchService {
  private readonly logger = new Logger(LarkBotDispatchService.name);
  private readonly seenEventIds = new Map<string, number>();
  private readonly EVENT_DEDUP_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: LarkBotService,
    private readonly render: RenderService,
  ) {}

  listBotTemplates(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.template.findMany({
      where: BOT_TEMPLATE_WHERE,
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

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

  /** 迁自 controller.event() 的 step 4.1 起;字段改归一化 payload。 */
  async handleMessageReceive(p: NormalizedMessageEvent): Promise<void> {
    if (!this.isFirstSeenEvent(p.eventId)) {
      this.logger.log(`[diag] event ignored: duplicate event_id=${p.eventId}`);
      return;
    }
    const botOpenId = process.env.LARK_BOT_OPEN_ID;
    if (p.senderType !== 'user') return;
    if (botOpenId && p.senderOpenId === botOpenId) return;
    if (p.message.chatType === 'group') {
      if (!botOpenId) {
        this.logger.warn('LARK_BOT_OPEN_ID 未配置,群 @ 检测跳过 → 忽略群消息');
        return;
      }
      if (!p.message.mentions.includes(botOpenId)) return;
    }
    const existing = await this.prisma.larkBotSession.findFirst({
      where: { chatId: p.message.chatId, triggerOpenId: p.senderOpenId, state: { in: ['select_template', 'fill_fields'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return;
    const session = await this.prisma.larkBotSession.create({
      data: { chatId: p.message.chatId, chatType: p.message.chatType, triggerOpenId: p.senderOpenId, state: 'select_template' },
    });
    try {
      const templates = await this.listBotTemplates();
      if (templates.length === 0) {
        await this.bot.sendTextWithMention({ chatId: p.message.chatId, atOpenId: p.senderOpenId, text: '当前没有可用模板,请先在「模板打印平台」创建模板。' });
        await this.prisma.larkBotSession.update({ where: { id: session.id }, data: { state: 'failed', errorMsg: 'no_templates' } });
        return;
      }
      const card = buildSelectTemplateCard({ sessionId: session.id, templates });
      const cardMessageId = await this.bot.sendCard(p.message.chatId, card);
      await this.prisma.larkBotSession.update({ where: { id: session.id }, data: { cardMessageId } });
    } catch (e) {
      this.logger.error(`handleMessageReceive send card failed: ${(e as Error).message}`);
      await this.prisma.larkBotSession.update({ where: { id: session.id }, data: { state: 'failed', errorMsg: (e as Error).message } });
    }
  }

  /** 迁自 controller.cardAction() 的去重起;返回 {toast,card} 或 {ok:true}。整段 try/catch 防 handler 抛错。 */
  async handleCardAction(p: NormalizedCardAction): Promise<unknown> {
    try {
      if (!this.isFirstSeenEvent(p.eventId)) return { ok: true };
      let sessionId = p.action.value?.sessionId;
      let action = p.action.value?.action;
      if ((!sessionId || !action) && p.action.name) {
        const m = /^([a-z_]+)__(.+)$/.exec(p.action.name);
        if (m) { action = action ?? m[1]; sessionId = sessionId ?? m[2]; }
      }
      if (!sessionId || !action) return { ok: true };
      const session = await this.prisma.larkBotSession.findUnique({ where: { id: sessionId } });
      if (!session) return { ok: true };

      if (session.state === 'select_template' && action === 'template_selected') {
        const templateId = p.action.option;
        if (!templateId) return { toast: { type: 'error', content: '未选择模板' } };
        const tpl = await this.prisma.template.findFirst({ where: { id: templateId, ...BOT_TEMPLATE_WHERE } });
        if (!tpl) return { toast: { type: 'error', content: '模板不可用或未发布' } };
        await this.prisma.larkBotSession.update({ where: { id: session.id }, data: { templateId, state: 'fill_fields', formData: {} } });
        const fields = extractFields(tpl.data);
        const card = buildFieldFormCard({ sessionId: session.id, templateName: tpl.name, fields, values: {} });
        return { toast: { type: 'success', content: `已选「${tpl.name}」` }, card: { type: 'raw', data: card } };
      }

      if (session.state === 'fill_fields' && action === 'submit_render') {
        const tpl = session.templateId
          ? await this.prisma.template.findFirst({ where: { id: session.templateId, ...BOT_TEMPLATE_WHERE } })
          : null;
        if (!tpl) return { toast: { type: 'error', content: '模板不可用或未发布' } };
        const fields = extractFields(tpl.data);
        const formData = (p.action.formValue as Record<string, unknown> | undefined) ?? (session.formData as Record<string, unknown>) ?? {};
        const missing = fields.filter((f) => f.required && (formData[f.key] === undefined || formData[f.key] === ''));
        if (missing.length > 0) return { toast: { type: 'error', content: `必填未填:${missing.map((m) => m.label).join('、')}` } };
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
          const { jobId } = await this.render.enqueue(null, { templateId: session.templateId!, data, formats: ['pdf'], callbackUrl });
          await this.prisma.larkBotSession.update({ where: { id: session.id }, data: { renderJobId: jobId, state: 'rendering' } });
          return { toast: { type: 'info', content: '已入队,渲染中…' }, card: { type: 'raw', data: buildRenderingCard({ jobId, templateName: tpl.name }) } };
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
```

> **注意 `extractFields`:** 当前在 `lark-bot.controller.ts` 里(本地函数)。把它**迁到 `lark-bot-cards.ts` 并 export**(它本就与卡片同域),dispatch 与 controller 都从那里 import。若已在 `lark-bot-cards.ts` 则直接 import。

- [ ] **Step 3: tsc**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 通过(controller 仍引用旧逻辑会在 Task 5 清理;本步若 controller 报未用变量,留到 Task 5)。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/lark/lark-bot-dispatch.service.ts apps/api/src/lark/lark-bot-cards.ts
git commit -m "feat(lark): 抽 LarkBotDispatchService(归一化 payload,业务逻辑迁入)"
```

---

### Task 3: dispatch service 单测(fixture 用真实 WS targetData 形态)

**Files:**
- Test: `apps/api/test/lark-bot-dispatch.spec.ts`

- [ ] **Step 1: 写测试**(mock Prisma/Bot/Render,喂归一化 payload)

`apps/api/test/lark-bot-dispatch.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from '../src/lark/lark-bot-dispatch.service.js';

function makeSvc(overrides: { sessionFindFirst?: unknown; create?: unknown } = {}) {
  const sendCard = jest.fn(async () => 'om_card');
  const sendTextWithMention = jest.fn(async () => undefined);
  const create = jest.fn(async () => ({ id: 's-new', ...(overrides.create as object) }));
  const update = jest.fn(async () => ({}));
  const templateFindMany = jest.fn(async () => [{ id: 't1', name: '模板A' }]);
  const sessionFindFirst = jest.fn(async () => overrides.sessionFindFirst ?? null);
  const prisma = {
    larkBotSession: { findFirst: sessionFindFirst, create, update, findUnique: jest.fn(async () => null) },
    template: { findMany: templateFindMany, findFirst: jest.fn(async () => null) },
  } as never;
  const bot = { sendCard, sendTextWithMention } as never;
  const render = { enqueue: jest.fn(async () => ({ jobId: 'j1' })) } as never;
  const svc = new LarkBotDispatchService(prisma, bot, render);
  return { svc, sendCard, sendTextWithMention, create, update };
}

const p2p = {
  eventId: 'e1',
  senderOpenId: 'ou_user',
  senderType: 'user',
  message: { messageId: 'om1', chatId: 'oc1', chatType: 'p2p' as const, messageType: 'text', mentions: [] },
};

describe('LarkBotDispatchService.handleMessageReceive', () => {
  beforeEach(() => { delete process.env.LARK_BOT_OPEN_ID; });

  it('私聊消息 → 建会话并发选择卡', async () => {
    const { svc, create, sendCard } = makeSvc();
    await svc.handleMessageReceive(p2p);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sendCard).toHaveBeenCalledTimes(1);
  });

  it('重复 event_id → 跳过', async () => {
    const { svc, create } = makeSvc();
    await svc.handleMessageReceive(p2p);
    await svc.handleMessageReceive(p2p); // 同 eventId
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sender_type 非 user(自回环)→ 跳过', async () => {
    const { svc, create } = makeSvc();
    await svc.handleMessageReceive({ ...p2p, eventId: 'e2', senderType: 'app' });
    expect(create).not.toHaveBeenCalled();
  });

  it('群消息未 @ 机器人 → 跳过', async () => {
    process.env.LARK_BOT_OPEN_ID = 'ou_bot';
    const { svc, create } = makeSvc();
    await svc.handleMessageReceive({ ...p2p, eventId: 'e3', message: { ...p2p.message, chatType: 'group', mentions: [] } });
    expect(create).not.toHaveBeenCalled();
  });

  it('群消息 @ 了机器人 → 建会话', async () => {
    process.env.LARK_BOT_OPEN_ID = 'ou_bot';
    const { svc, create } = makeSvc();
    await svc.handleMessageReceive({ ...p2p, eventId: 'e4', message: { ...p2p.message, chatType: 'group', mentions: ['ou_bot'] } });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试**

Run: `cd apps/api && npx jest --config jest.config.cjs --runInBand --forceExit test/lark-bot-dispatch.spec.ts`
Expected: PASS(5 个用例)。如失败,核对 dispatch 字段访问是否已全部改用归一化 payload。

- [ ] **Step 3: 提交**

```bash
git add apps/api/test/lark-bot-dispatch.spec.ts
git commit -m "test(lark): LarkBotDispatchService 单测(私聊/群@/自回环/去重)"
```

---

### Task 4: `LarkBotWsService` + 模块接线 + `enableShutdownHooks`

**Files:**
- Create: `apps/api/src/lark/lark-bot-ws.service.ts`
- Modify: `apps/api/src/lark/lark.module.ts`、`apps/api/src/app-bootstrap.ts`

- [ ] **Step 1: 写 WS 胶水**

`apps/api/src/lark/lark-bot-ws.service.ts`:
```ts
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import * as lark from '@larksuiteoapi/node-sdk';

import { fromWsCardAction, fromWsMessage } from './lark-bot-payload.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from './lark-bot-dispatch.service.js';

@Injectable()
export class LarkBotWsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LarkBotWsService.name);
  private wsClient?: lark.WSClient;

  constructor(private readonly dispatch: LarkBotDispatchService) {}

  onApplicationBootstrap(): void {
    if (process.env.LARK_BOT_LONG_CONN_ENABLED !== 'true') {
      this.logger.log('LARK_BOT_LONG_CONN_ENABLED!=true → 跳过 WS 长连接');
      return;
    }
    const appId = process.env.LARK_SSO_APP_ID;
    const appSecret = process.env.LARK_SSO_APP_SECRET;
    if (!appId || !appSecret) {
      this.logger.warn('缺 LARK_SSO_APP_ID/SECRET → 跳过 WS');
      return;
    }
    try {
      this.wsClient = new lark.WSClient({ appId, appSecret, domain: lark.Domain.Feishu });
      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: Record<string, unknown>) => {
          await this.dispatch.handleMessageReceive(fromWsMessage(data));
          return undefined;
        },
        'card.action.trigger': async (data: Record<string, unknown>) =>
          this.dispatch.handleCardAction(fromWsCardAction(data)),
      });
      // start 异常只 warn,不阻塞 api;断线由 SDK 自动重连
      void this.wsClient.start({ eventDispatcher: dispatcher });
      this.logger.log('飞书 bot 长连接已启动(Domain.Feishu)');
    } catch (e) {
      this.logger.warn(`WS 启动失败(不阻塞 api):${(e as Error).message}`);
    }
  }

  onApplicationShutdown(): void {
    // SDK 当前无公开 stop();进程退出会关连接。若 SDK 版本提供关闭 API,在此调用。
    // 保留 hook 以便未来补显式关闭,避免滚动部署双收。
    this.logger.log('app 关闭中:WS 连接随进程退出释放');
  }
}
```

> **实现期校验:** ① `lark.Domain.Feishu` 是否存在(SDK 导出含 `Domain`,确认其有 `Feishu` 成员);② `card.action.trigger` 注册到 `EventDispatcher.register` 是否被 SDK 接受(若 TS 类型 `IHandles` 不含该键,用 `register({ ... } as never)` 或查 SDK 对卡片事件的注册方式);③ WSClient 是否有可用的关闭方法,有则在 `onApplicationShutdown` 调用。

- [ ] **Step 2: 模块注册**(`apps/api/src/lark/lark.module.ts` 的 providers 数组追加)

```ts
// import 区追加:
// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from './lark-bot-dispatch.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotWsService } from './lark-bot-ws.service.js';

// providers 数组追加这两项(LarkBotDispatchService 注入 Prisma/LarkBotService/RenderService;
// 这些已在 LarkModule 可见——PrismaModule @Global、LarkBotService 本模块、RenderModule 已 import):
LarkBotDispatchService,
LarkBotWsService,
```

- [ ] **Step 3: 开 shutdown hooks**(`apps/api/src/app-bootstrap.ts` `configureApp` 内,trust proxy 之后)

```ts
  // OnApplicationShutdown 钩子需显式开启,否则 LarkBotWsService 等的关闭逻辑不触发(滚动部署防双收)。
  app.enableShutdownHooks();
```

- [ ] **Step 4: tsc + 启动门控冒烟**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 通过。若 `Domain.Feishu` / `register` 类型报错,按 Step 1 校验注记处理。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/lark/lark-bot-ws.service.ts apps/api/src/lark/lark.module.ts apps/api/src/app-bootstrap.ts
git commit -m "feat(lark): WSClient 长连接胶水 + enableShutdownHooks"
```

---

### Task 5: 瘦身 controller 为适配壳(保留 fallback)

**Files:**
- Modify: `apps/api/src/lark/lark-bot.controller.ts`

- [ ] **Step 1: 改 `event()` / `cardAction()` 为薄壳**

`event()` 改为(保留 challenge + token 校验,业务体改调 dispatch):
```ts
  @Public()
  @Post('event')
  @HttpCode(HttpStatus.OK)
  async event(@Body() raw: unknown): Promise<unknown> {
    const challenge = EventChallenge.safeParse(raw);
    if (challenge.success) return { challenge: challenge.data.challenge };
    const parsed = EventEnvelope.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const ev = parsed.data;
    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || ev.header.token !== expected) throw new UnauthorizedException('verification_token_mismatch');
    if (ev.header.event_type !== 'im.message.receive_v1') return { ok: true };
    await this.dispatch.handleMessageReceive(fromHttpMessage(ev));
    return { ok: true };
  }
```

`cardAction()` 改为:
```ts
  @Public()
  @Post('card-action')
  @HttpCode(HttpStatus.OK)
  async cardAction(@Body() raw: unknown): Promise<unknown> {
    const challenge = EventChallenge.safeParse(raw);
    if (challenge.success) return { challenge: challenge.data.challenge };
    const parsed = CardActionBody.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const body = parsed.data;
    const expected = process.env.LARK_BOT_VERIFICATION_TOKEN;
    if (!expected || body.header.token !== expected) throw new UnauthorizedException('verification_token_mismatch');
    return this.dispatch.handleCardAction(fromHttpCardAction(body));
  }
```

- [ ] **Step 2: 清理迁走的成员**

删 controller 里的 `seenEventIds` / `EVENT_DEDUP_TTL_MS` / `isFirstSeenEvent` / `listBotTemplates`(已迁入 dispatch);构造器注入 `LarkBotDispatchService`(替换不再直接用的依赖,但 `render-callback` 仍用 `prisma`/`bot`,故保留它们);import 加 `fromHttpMessage`/`fromHttpCardAction`。`render-callback` 方法及其 `RenderCallbackDto`/`STORAGE_ROOT`/path 逻辑**完全不动**。

- [ ] **Step 3: tsc + 现有 bot e2e 回归**

Run: `cd apps/api && npx tsc --noEmit && DATABASE_URL='postgres://postgres:postgres@localhost:6432/template_printing' REDIS_URL='redis://localhost:6479' npx jest --config jest.config.cjs --runInBand --forceExit test/lark-bot-template-visibility.e2e.spec.ts test/render-callback-idempotency.e2e.spec.ts`
Expected: PASS(HTTP 路径经适配仍走通,fallback 有效)。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/lark/lark-bot.controller.ts
git commit -m "refactor(lark): bot HTTP 端点瘦身为适配壳(保留作 WS fallback)"
```

---

### Task 6: env 开关 + 跨字段断言调整 + 同步

**Files:**
- Modify: `apps/api/src/common/env.ts`、`.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`

- [ ] **Step 1: env.ts 加开关 + 调断言**

`EnvSchema` 加:
```ts
  // bot 长连接(WS)开关:true 才在 api 进程内起 WSClient(单副本部署时仅一个副本设 true)
  LARK_BOT_LONG_CONN_ENABLED: z
    .enum(['true', 'false'])
    .optional(),
```
把批次5 那条 `LARK_BOT_VERIFICATION_TOKEN && !LARK_BOT_OPEN_ID → warn` 改为以 bot 启用为触发、只看 open_id:
```ts
  // bot 启用(长连接 或 配了 verification token)却缺 open_id → 群 @ 检测失效,warn。
  if ((env.LARK_BOT_LONG_CONN_ENABLED === 'true' || env.LARK_BOT_VERIFICATION_TOKEN) && !env.LARK_BOT_OPEN_ID) {
    // eslint-disable-next-line no-console
    console.warn('[env] bot 已启用但缺 LARK_BOT_OPEN_ID — 群内 @ 机器人无法识别。');
  }
```

- [ ] **Step 2: `.env.prod.example` 加项**(LARK_BOT_OPEN_ID 之后)
```
LARK_BOT_LONG_CONN_ENABLED=false      # bot 长连接;生产单副本设 true(多副本仅一个副本 true)
```
并在 `LARK_BOT_VERIFICATION_TOKEN` 行注释补「WS 模式不校验,但保留以兼容 HTTP fallback / 内部 render-callback token」。

- [ ] **Step 3: env-sync 白名单**(`NON_ENVTS_ALLOWED` 不需要加——`LARK_BOT_LONG_CONN_ENABLED` 已进 env.ts schema;确认 `.env.prod.example` 的键都在 schema 或白名单。)

- [ ] **Step 4: 跑 env 测试**

Run: `cd apps/api && npx jest --config jest.config.cjs --runInBand --forceExit test/env.spec.ts test/env-example-sync.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/common/env.ts .env.prod.example apps/api/test/env-example-sync.spec.ts
git commit -m "feat(lark): LARK_BOT_LONG_CONN_ENABLED 开关 + env 断言对齐 WS"
```

---

### Task 7: WS 门控单测

**Files:**
- Test: `apps/api/test/lark-bot-ws-gating.spec.ts`

- [ ] **Step 1: 写测试**(开关 false / 缺凭证 → 不构造 WSClient)

```ts
import { describe, it, expect, jest, afterEach } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { LarkBotWsService } from '../src/lark/lark-bot-ws.service.js';

const dispatch = { handleMessageReceive: jest.fn(), handleCardAction: jest.fn() } as never;

afterEach(() => {
  delete process.env.LARK_BOT_LONG_CONN_ENABLED;
  delete process.env.LARK_SSO_APP_ID;
  delete process.env.LARK_SSO_APP_SECRET;
});

describe('LarkBotWsService 门控', () => {
  it('开关未设 → onApplicationBootstrap 不抛、不连', () => {
    const svc = new LarkBotWsService(dispatch);
    expect(() => svc.onApplicationBootstrap()).not.toThrow();
  });

  it('开关 true 但缺凭证 → 不抛(warn skip)', () => {
    process.env.LARK_BOT_LONG_CONN_ENABLED = 'true';
    const svc = new LarkBotWsService(dispatch);
    expect(() => svc.onApplicationBootstrap()).not.toThrow();
  });
});
```

> 说明:开关 true + 有凭证会真连飞书,不在 CI 测;真实连接走 Task 9 手测。

- [ ] **Step 2: 跑测试**

Run: `cd apps/api && npx jest --config jest.config.cjs --runInBand --forceExit test/lark-bot-ws-gating.spec.ts`
Expected: PASS(2 用例)。

- [ ] **Step 3: 提交**

```bash
git add apps/api/test/lark-bot-ws-gating.spec.ts
git commit -m "test(lark): WS 门控单测(开关/凭证缺失不连不抛)"
```

---

### Task 8: 文档同步

**Files:**
- Modify: `docs/PROGRESS.md`、`docs/deployment.md`、`docs/PRE_DEPLOYMENT_CHECKLIST.md`、`examples/lark-bot/README.md`

- [ ] **Step 1: 更新文档**
  - `PROGRESS.md` 第 3 节追加本次变更 + "最近更新"日期。
  - `deployment.md`:补长连接小节(`LARK_BOT_LONG_CONN_ENABLED`、**ECS 出网放行 WSS 到飞书**、单副本门控、HTTP 端点保留作 fallback)。
  - `PRE_DEPLOYMENT_CHECKLIST.md`:① 飞书应用「事件与回调」配为**长连接模式**;② **ECS 安全组/出网放行到飞书的 WSS(出站,nginx 只管入站,易漏)**;③ `LARK_BOT_LONG_CONN_ENABLED=true`(单副本);④ **即便 WS 模式也保留 `LARK_BOT_VERIFICATION_TOKEN` 配置值**(否则切回 HTTP fallback 时 fail-closed)。
  - `examples/lark-bot/README.md`:配置步骤从"事件订阅回调 URL"改为"开启长连接"。

- [ ] **Step 2: 提交**

```bash
git add docs/PROGRESS.md docs/deployment.md docs/PRE_DEPLOYMENT_CHECKLIST.md examples/lark-bot/README.md
git commit -m "docs: 飞书 bot 长连接(env/出网WSS/单副本门控/fallback)同步"
```

---

### Task 9: 手测 go/no-go 闸(删除 fallback 前必过)

**Files:** 无(验证步骤)

- [ ] **Step 1: 本地真连冒烟**
  - 本地 `.env` 设 `LARK_BOT_LONG_CONN_ENABLED=true`,起 api(`pnpm --filter @template-printing/api dev`)。
  - 日志应出现「飞书 bot 长连接已启动」。
- [ ] **Step 2: 真实 targetData 形态确认(live-log)**
  - 在 dispatch 入口临时 `logger.debug(JSON.stringify(payloadRaw))`(或在 WS adapter 前打 raw `data`)。
  - **由用户在飞书工作区操作**:① 私聊机器人发一条;② 群里 @ 机器人;③ 点一次卡片下拉。把三条 raw 日志贴回。
  - 核对与 `lark-bot-payload.ts` 适配假设一致(spec §2.1);不一致则修适配函数 + Task 1 fixture。
- [ ] **Step 3: 端到端卡片往返(关键,SDK 无法纯静态确认)**
  - 群里 @ 机器人 → 选模板 → 填字段 → 提交渲染 → 确认:① 卡片随每步**正确更新**(toast + 新卡片);② 渲染完成后群里收到 PDF 文件消息 + @ 触发者。
  - **任一步卡片不更新/不回传 → no-go**:排查 `handleCardAction` 返回结构(`{toast,card:{type:'raw',data}}`)与 SDK WS 回传(`respPayload.data=base64`)是否匹配,修复后再验。
- [ ] **Step 4: 通过后记录**:在 PROGRESS 注明"长连接手测通过(选模板→填→渲染→出 PDF + 卡片更新)";此后方可在后续迭代发 cleanup commit 删 HTTP fallback 端点。

---

## Self-Review

- **Spec 覆盖**:§3.1 dispatch→Task2/3;§3.2 WS 胶水+生命周期→Task4(+enableShutdownHooks 补 plan 加项);§3.3 controller fallback→Task5;§3.4 模块→Task4;§5 错误/多副本→Task4(handler try/catch)+Task8(门控文档);§6 env→Task6;§7 测试→Task3/7/9;§8 文档→Task8;§2.1 payload 扁平化→Task1 + Task9 live-log。三个 plan 加项(enableShutdownHooks/保留 token/卡片 go-no-go)分别落 Task4/Task6+8/Task9。✅
- **占位扫描**:无 TBD;Task1/4/7 含完整代码;Task2 用"迁移+字段映射表"而非占位(给出精确替换表 + 完整新方法体)。
- **类型一致**:`NormalizedMessageEvent`/`NormalizedCardAction` 在 Task1 定义,Task2/3/4 一致使用;适配函数名 `fromWsMessage`/`fromHttpMessage`/`fromWsCardAction`/`fromHttpCardAction` 全程一致。
- **风险**:`lark.Domain.Feishu`、`card.action.trigger` 注册类型、WSClient 关闭 API 三处 SDK 细节在 Task4 Step1 注记为实现期校验(不阻塞架构)。
