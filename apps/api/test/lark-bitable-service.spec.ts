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
import { LarkBitableService } from '../src/lark/lark-bitable.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkImService } from '../src/lark/lark-im.service.js';

const OPEN_BASE = 'https://open.feishu.cn';

describe('LarkBitableService', () => {
  let im: LarkImService;
  let svc: LarkBitableService;
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

    im = new LarkImService({
      appId: 'cli_test',
      appSecret: 'secret_test',
      openBase: OPEN_BASE,
    });
    svc = new LarkBitableService(im, { openBase: OPEN_BASE });

    // Pre-stub tenant_access_token endpoint (used by every call)
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({ path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', tenant_access_token: 'fake_token', expire: 7200 })
      .persist();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  // -------------------- updateRecord --------------------

  it('updateRecord PUTs JSON body and bearer header', async () => {
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({
        path: '/open-apis/bitable/v1/apps/APP/tables/TBL/records/REC',
        method: 'PUT',
      })
      .reply(200, { code: 0, msg: 'ok', data: { record: {} } });

    await expect(
      svc.updateRecord({
        appToken: 'APP',
        tableId: 'TBL',
        recordId: 'REC',
        fields: { 状态: '已完成', 附件: [{ file_token: 'tok_xx' }] },
      }),
    ).resolves.toBeUndefined();
  });

  it('updateRecord throws when Lark returns non-zero code', async () => {
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({
        path: '/open-apis/bitable/v1/apps/APP/tables/TBL/records/REC',
        method: 'PUT',
      })
      .reply(200, { code: 99991663, msg: 'permission denied' });

    await expect(
      svc.updateRecord({
        appToken: 'APP',
        tableId: 'TBL',
        recordId: 'REC',
        fields: {},
      }),
    ).rejects.toThrow(/code=99991663/);
  });

  // -------------------- uploadMaterial (small) --------------------

  it('uploadMaterial < 20MB uses upload_all and returns file_token', async () => {
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_all', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { file_token: 'fake_file_token_small' } });

    const buf = Buffer.alloc(1024, 0xab); // 1KB
    const token = await svc.uploadMaterial({
      parentNode: 'TBL',
      fileName: 'test.pdf',
      fileBuffer: buf,
    });
    expect(token).toBe('fake_file_token_small');
  });

  it('uploadMaterial small surfaces Lark error code', async () => {
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_all', method: 'POST' })
      .reply(200, { code: 1061004, msg: 'file too big' });

    await expect(
      svc.uploadMaterial({
        parentNode: 'TBL',
        fileName: 'test.pdf',
        fileBuffer: Buffer.alloc(1024),
      }),
    ).rejects.toThrow(/code=1061004/);
  });

  // -------------------- uploadMaterial (chunked) --------------------

  it('uploadMaterial >= 20MB uses upload_prepare/part/finish and returns file_token', async () => {
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_prepare', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { upload_id: 'uid_xx' } });

    // 21 MB → 6 chunks of 4 MB (last is 1 MB)
    let partCount = 0;
    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_part', method: 'POST' })
      .reply(() => {
        partCount += 1;
        return { statusCode: 200, data: { code: 0, msg: 'ok' } };
      })
      .persist();

    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_finish', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { file_token: 'fake_file_token_big' } });

    const buf = Buffer.alloc(21 * 1024 * 1024, 0xcd);
    const token = await svc.uploadMaterial({
      parentNode: 'TBL',
      fileName: 'big.pdf',
      fileBuffer: buf,
    });

    expect(token).toBe('fake_file_token_big');
    expect(partCount).toBe(6); // 4+4+4+4+4+1 = 21 MB → ceil(21/4)=6
  });

  it('uploadMaterial chunked surfaces error on part failure', async () => {
    const pool = mockAgent.get(OPEN_BASE);
    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_prepare', method: 'POST' })
      .reply(200, { code: 0, msg: 'ok', data: { upload_id: 'uid_xx' } });

    pool
      .intercept({ path: '/open-apis/drive/v1/medias/upload_part', method: 'POST' })
      .reply(200, { code: 1062001, msg: 'chunk size mismatch' })
      .persist();

    await expect(
      svc.uploadMaterial({
        parentNode: 'TBL',
        fileName: 'big.pdf',
        fileBuffer: Buffer.alloc(21 * 1024 * 1024),
      }),
    ).rejects.toThrow(/upload_part seq=0 code=1062001/);
  });
});
