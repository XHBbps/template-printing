import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from '../src/auth/jwt/refresh-token.service.js';

describe('RefreshTokenService', () => {
  const prisma = new PrismaClient();
  const svc = new RefreshTokenService(prisma, 60); // 60s TTL for test
  let userId: string;

  beforeAll(async () => {
    // 仅创建本测试自己的用户;切勿无条件 deleteMany 清空全表 ——
    // 对 dev/共享库跑 e2e 会连真实 admin 一起删掉(随后被 bootstrap 以默认密码重建)。
    const u = await prisma.user.create({
      data: { role: 'user', name: 'Test', larkOpenId: 'ou_test_' + Date.now() },
    });
    userId = u.id;
  });

  afterAll(async () => {
    // 只清理本测试范围内的数据(按 userId),不动其它用户。
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates a token, returns plaintext + record id', async () => {
    const { plaintext, id } = await svc.create(userId);
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
    const row = await prisma.refreshToken.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).not.toBe(plaintext);
  });

  it('verify accepts valid plaintext and returns userId', async () => {
    const { plaintext } = await svc.create(userId);
    const result = await svc.verify(plaintext);
    expect(result?.userId).toBe(userId);
  });

  it('verify rejects unknown plaintext', async () => {
    const result = await svc.verify('0'.repeat(64));
    expect(result).toBeNull();
  });

  it('verify rejects revoked tokens', async () => {
    const { plaintext, id } = await svc.create(userId);
    await svc.revoke(id);
    const result = await svc.verify(plaintext);
    expect(result).toBeNull();
  });

  it('verify rejects expired tokens', async () => {
    const shortLived = new RefreshTokenService(prisma, 1);
    const { plaintext } = await shortLived.create(userId);
    await new Promise((r) => setTimeout(r, 1100));
    const result = await shortLived.verify(plaintext);
    expect(result).toBeNull();
  });
});
