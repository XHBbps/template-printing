import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from '../src/lark/lark-bot-dispatch.service.js';
// eslint-disable-next-line import/no-unresolved
import type { NormalizedMessageEvent } from '../src/lark/lark-bot-payload.js';

function makeSvc() {
  const sendCard = jest.fn(async () => 'om_card');
  const sendTextWithMention = jest.fn(async () => undefined);
  const create = jest.fn(async () => ({ id: 's-new' }));
  const update = jest.fn(async () => ({}));
  const findFirst = jest.fn(async () => null);
  const templateFindMany = jest.fn(async () => [{ id: 't1', name: '模板A' }]);
  const prisma = {
    larkBotSession: { findFirst, create, update, findUnique: jest.fn(async () => null) },
    template: { findMany: templateFindMany, findFirst: jest.fn(async () => null) },
  } as never;
  const bot = { sendCard, sendTextWithMention } as never;
  const render = { enqueue: jest.fn(async () => ({ jobId: 'j1' })) } as never;
  const svc = new LarkBotDispatchService(prisma, bot, render);
  return { svc, sendCard, sendTextWithMention, create, update, findFirst };
}

const p2p: NormalizedMessageEvent = {
  eventId: 'e1',
  senderOpenId: 'ou_user',
  senderType: 'user',
  message: {
    messageId: 'om1',
    chatId: 'oc1',
    chatType: 'p2p',
    messageType: 'text',
    mentions: [],
  },
};

describe('LarkBotDispatchService.handleMessageReceive', () => {
  beforeEach(() => {
    delete process.env.LARK_BOT_OPEN_ID;
  });

  it('私聊消息 → 建会话并发选择卡', async () => {
    const { svc, create, sendCard } = makeSvc();
    await svc.handleMessageReceive(p2p);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sendCard).toHaveBeenCalledTimes(1);
  });

  it('重复 event_id → 跳过(同一 svc 实例内去重)', async () => {
    const { svc, create } = makeSvc();
    await svc.handleMessageReceive(p2p);
    await svc.handleMessageReceive(p2p);
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
    await svc.handleMessageReceive({
      ...p2p,
      eventId: 'e3',
      message: { ...p2p.message, chatType: 'group', mentions: [] },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('群消息 @ 了机器人 → 建会话', async () => {
    process.env.LARK_BOT_OPEN_ID = 'ou_bot';
    const { svc, create } = makeSvc();
    await svc.handleMessageReceive({
      ...p2p,
      eventId: 'e4',
      message: { ...p2p.message, chatType: 'group', mentions: ['ou_bot'] },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('LarkBotDispatchService.handleCardAction — submit_render 字段归一化', () => {
  it('date 字段去掉飞书 date_picker 的 +0800 时区,只留 YYYY-MM-DD', async () => {
    const enqueue = jest.fn(async () => ({ jobId: 'j1' }));
    const tplData = {
      schema: { out_date: { type: 'date', label: '出门日期', required: false } },
    };
    const prisma = {
      larkBotSession: {
        findUnique: jest.fn(async () => ({
          id: 's1',
          state: 'fill_fields',
          templateId: 't1',
          formData: {},
        })),
        update: jest.fn(async () => ({})),
      },
      template: { findFirst: jest.fn(async () => ({ id: 't1', name: 'tpl', data: tplData })) },
    } as never;
    const svc = new LarkBotDispatchService(prisma, {} as never, { enqueue } as never);

    await svc.handleCardAction({
      eventId: 'card-date-1',
      action: {
        value: { sessionId: 's1', action: 'submit_render' },
        formValue: { out_date: '2026-05-29 +0800' },
      },
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const args = (
      enqueue.mock.calls[0] as unknown as [unknown, { data: Record<string, unknown> }]
    )[1];
    expect(args.data.out_date).toBe('2026-05-29');
  });

  it('number 字段空输入 → 不强转 0,留空(omitted);有值才转数字', async () => {
    const enqueue = jest.fn(async () => ({ jobId: 'j2' }));
    const tplData = {
      schema: {
        weight: { type: 'number', label: '重量', required: false },
        num: { type: 'number', label: '数量', required: false },
      },
    };
    const prisma = {
      larkBotSession: {
        findUnique: jest.fn(async () => ({
          id: 's2',
          state: 'fill_fields',
          templateId: 't2',
          formData: {},
        })),
        update: jest.fn(async () => ({})),
      },
      template: { findFirst: jest.fn(async () => ({ id: 't2', name: 'tpl', data: tplData })) },
    } as never;
    const svc = new LarkBotDispatchService(prisma, {} as never, { enqueue } as never);

    await svc.handleCardAction({
      eventId: 'card-num-1',
      action: {
        value: { sessionId: 's2', action: 'submit_render' },
        formValue: { weight: '', num: '50' }, // weight 空、num 有值
      },
    });

    const args = (
      enqueue.mock.calls[0] as unknown as [unknown, { data: Record<string, unknown> }]
    )[1];
    expect(args.data.num).toBe(50); // 有值 → 数字
    expect('weight' in args.data).toBe(false); // 空 → 不入 data(渲染留空,非 0)
  });
});
