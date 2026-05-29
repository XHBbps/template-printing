import { describe, it, expect } from '@jest/globals';

import {
  fromWsMessage,
  fromHttpMessage,
  fromWsCardAction,
  fromHttpCardAction,
  // eslint-disable-next-line import/no-unresolved
} from '../src/lark/lark-bot-payload.js';

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
      chat_type: 'p2p' as const,
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
    expect(fromWsCardAction(ws).action.value).toEqual({
      sessionId: 's1',
      action: 'template_selected',
    });
  });
});
