// eslint-disable-next-line import/no-unresolved
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
// eslint-disable-next-line import/no-unresolved
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  Dispatcher,
  // eslint-disable-next-line import/no-unresolved
} from 'undici';

// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from '../src/lark/lark-bot.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkImService } from '../src/lark/lark-im.service.js';

const OPEN_BASE = 'https://open.feishu.cn';

describe('LarkBotService', () => {
  let im: LarkImService;
  let svc: LarkBotService;
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeAll(() => {
    originalDispatcher = getGlobalDispatcher();
  });

  afterAll(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    im = new LarkImService({ appId: 'cli_test', appSecret: 'secret_test', openBase: OPEN_BASE });
    svc = new LarkBotService(im, { openBase: OPEN_BASE });

    // Pre-stub tenant_access_token
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', tenant_access_token: 'fake_token', expire: 7200 })
      .persist();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  // -------------------- sendCard --------------------

  it('sendCard POSTs interactive message and returns message_id', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/messages?receive_id_type=chat_id', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { message_id: 'om_fake_card' } });

    const mid = await svc.sendCard('oc_chat', { foo: 'bar' });
    expect(mid).toBe('om_fake_card');
  });

  it('sendCard throws with lark code/msg on error', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/messages?receive_id_type=chat_id', method: 'POST' })
      .reply(200, { code: 230002, msg: 'chat not found' });

    await expect(svc.sendCard('oc_x', {})).rejects.toThrow(/code=230002/);
  });

  // -------------------- updateCard --------------------

  it('updateCard PATCHes existing message', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/messages/om_card', method: 'PATCH' })
      .reply(200, { code: 0, msg: 'ok' });

    await expect(svc.updateCard('om_card', { updated: true })).resolves.toBeUndefined();
  });

  it('updateCard surfaces lark error', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/messages/om_x', method: 'PATCH' })
      .reply(200, { code: 230027, msg: 'message not found' });

    await expect(svc.updateCard('om_x', {})).rejects.toThrow(/code=230027/);
  });

  // -------------------- uploadIMFile --------------------

  it('uploadIMFile uploads and returns file_key', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/files', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { file_key: 'file_fake_xx' } });

    const key = await svc.uploadIMFile(Buffer.from('PDF content'), 'test.pdf', 'pdf');
    expect(key).toBe('file_fake_xx');
  });

  // -------------------- sendTextWithMention --------------------

  it('sendTextWithMention wraps text with <at> tag', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/messages?receive_id_type=chat_id', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { message_id: 'om_text' } });

    await expect(
      svc.sendTextWithMention({
        chatId: 'oc_x',
        atOpenId: 'ou_zhangsan',
        atName: '张三',
        text: '渲染完成',
      }),
    ).resolves.toBeUndefined();
  });

  // -------------------- sendFileMessage --------------------

  it('sendFileMessage sends file msg_type message', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/im/v1/messages?receive_id_type=chat_id', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { message_id: 'om_file' } });

    await expect(svc.sendFileMessage('oc_x', 'file_xx')).resolves.toBeUndefined();
  });
});
