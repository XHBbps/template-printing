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
