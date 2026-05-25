// eslint-disable-next-line import/no-unresolved
import { FileSigService } from '../src/uploads/file-sig.service.js';

const TEST_SECRET = 'a'.repeat(40);

describe('FileSigService', () => {
  let svc: FileSigService;

  beforeAll(() => {
    process.env.FILE_SIG_SECRET = TEST_SECRET;
    process.env.FILE_SIG_TTL_SEC = '3600';
    svc = new FileSigService();
  });

  afterAll(() => {
    delete process.env.FILE_SIG_TTL_SEC;
  });

  it('sign 然后 verify 同一文件名 返 true', () => {
    const token = svc.sign('abc-123.pdf');
    expect(svc.verify('abc-123.pdf', token)).toBe(true);
  });

  it('verify 用错的文件名 返 false', () => {
    const token = svc.sign('abc-123.pdf');
    expect(svc.verify('xyz-999.pdf', token)).toBe(false);
  });

  it('verify 篡改 token 的 hmac 部分 返 false', () => {
    const token = svc.sign('abc-123.pdf');
    const parts = token.split('.');
    const hmac = parts[0] ?? '';
    const exp = parts[1] ?? '';
    const tampered = hmac.replace(/^./, hmac[0] === '0' ? '1' : '0') + '.' + exp;
    expect(svc.verify('abc-123.pdf', tampered)).toBe(false);
  });

  it('verify 已过期 token 返 false', () => {
    const expired = svc.sign('abc-123.pdf', -10); // 10 秒前过期
    expect(svc.verify('abc-123.pdf', expired)).toBe(false);
  });

  it('verify 无 token 返 false', () => {
    expect(svc.verify('abc-123.pdf', null)).toBe(false);
    expect(svc.verify('abc-123.pdf', undefined)).toBe(false);
    expect(svc.verify('abc-123.pdf', '')).toBe(false);
  });

  it('verify 格式错乱 token 返 false', () => {
    expect(svc.verify('abc-123.pdf', 'noseparator')).toBe(false);
    expect(svc.verify('abc-123.pdf', '.123')).toBe(false);
    expect(svc.verify('abc-123.pdf', 'abc.')).toBe(false);
    expect(svc.verify('abc-123.pdf', 'abc.notanumber')).toBe(false);
  });

  it('signUrl 给 /uploads/render/xx.pdf 加 ?token=', () => {
    const signed = svc.signUrl('/uploads/render/job-abc.pdf');
    expect(signed).toMatch(/^\/uploads\/render\/job-abc\.pdf\?token=[0-9a-f]+\.\d+$/);
  });

  it('signUrl 给非 render 路径原样返', () => {
    expect(svc.signUrl('/uploads/asset.png')).toBe('/uploads/asset.png');
    expect(svc.signUrl('/external/foo.pdf')).toBe('/external/foo.pdf');
  });

  it('signUrl null/undefined → null', () => {
    expect(svc.signUrl(null)).toBeNull();
    expect(svc.signUrl(undefined)).toBeNull();
    expect(svc.signUrl('')).toBeNull();
  });

  it('FILE_SIG_SECRET 未设置时构造抛错', () => {
    delete process.env.FILE_SIG_SECRET;
    expect(() => new FileSigService()).toThrow(/FILE_SIG_SECRET/);
    // 恢复
    process.env.FILE_SIG_SECRET = TEST_SECRET;
  });

  it('FILE_SIG_SECRET < 32 字符 构造抛错', () => {
    process.env.FILE_SIG_SECRET = 'too-short';
    expect(() => new FileSigService()).toThrow(/FILE_SIG_SECRET/);
    process.env.FILE_SIG_SECRET = TEST_SECRET;
  });
});
