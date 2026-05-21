import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from '../src/auth/jwt/refresh-token.service.js';

describe('RefreshTokenService', () => {
  const prisma = new PrismaClient();
  const svc = new RefreshTokenService(prisma, 60); // 60s TTL for test
  let userId: string;

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    const u = await prisma.user.create({
      data: { role: 'user', name: 'Test', larkOpenId: 'ou_test_' + Date.now() },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
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
