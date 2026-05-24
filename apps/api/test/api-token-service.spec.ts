// eslint-disable-next-line import/no-unresolved
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
// eslint-disable-next-line import/no-unresolved
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import bcrypt from 'bcryptjs';

// eslint-disable-next-line import/no-unresolved
import { ApiTokenService } from '../src/auth/api-token/api-token.service.js';

describe('ApiTokenService', () => {
  const prisma = new PrismaClient();
  const svc = new ApiTokenService(prisma as never);

  const U1 = 'apitoken_e2e_u1';
  const U2 = 'apitoken_e2e_u2';
  let u1Id: string;
  let u2Id: string;

  beforeAll(async () => {
    // 清旧 + 创两个 user
    await prisma.user.deleteMany({
      where: { localUsername: { in: [U1, U2] } },
    });
    const u1 = await prisma.user.create({
      data: {
        localUsername: U1,
        localPasswordHash: await bcrypt.hash('x', 4),
        role: 'user',
        name: 'U1',
      },
    });
    const u2 = await prisma.user.create({
      data: {
        localUsername: U2,
        localPasswordHash: await bcrypt.hash('x', 4),
        role: 'user',
        name: 'U2',
      },
    });
    u1Id = u1.id;
    u2Id = u2.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [U1, U2] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.apiToken.deleteMany({ where: { userId: { in: [u1Id, u2Id] } } });
  });

  // ---------------- generation ----------------

  it('static generatePlaintext returns tpkn_ + 32 hex', () => {
    const p = ApiTokenService.generatePlaintext();
    expect(p).toMatch(/^tpkn_[0-9a-f]{32}$/);
  });

  it('static hash is deterministic SHA-256 hex', () => {
    const h1 = ApiTokenService.hash('tpkn_test');
    const h2 = ApiTokenService.hash('tpkn_test');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---------------- create ----------------

  it('create returns plaintext + record (no plaintext/hash on record)', async () => {
    const r = await svc.create(u1Id, 'demo');
    expect(r.plaintext).toMatch(/^tpkn_[0-9a-f]{32}$/);
    expect(r.record.name).toBe('demo');
    expect(r.record.prefix).toBe(r.plaintext.slice(0, 'tpkn_'.length + 8));
    expect(r.record.revokedAt).toBeNull();
    expect(r.record.lastUsedAt).toBeNull();
    // record 不该含 plaintext 或 hash
    expect(JSON.stringify(r.record)).not.toContain(r.plaintext);
  });

  // ---------------- verify ----------------

  it('verify returns user for valid token', async () => {
    const r = await svc.create(u1Id, 'demo');
    const v = await svc.verify(r.plaintext);
    expect(v).not.toBeNull();
    expect(v!.id).toBe(u1Id);
  });

  it('verify returns null for wrong plaintext', async () => {
    await svc.create(u1Id, 'demo');
    expect(await svc.verify('tpkn_wrong_token_here_padding_64ch')).toBeNull();
  });

  it('verify returns null for non-tpkn prefix', async () => {
    expect(await svc.verify('Bearer foo')).toBeNull();
    expect(await svc.verify('random')).toBeNull();
  });

  it('verify returns null for revoked token', async () => {
    const r = await svc.create(u1Id, 'demo');
    await svc.revoke(u1Id, r.record.id);
    const v = await svc.verify(r.plaintext);
    expect(v).toBeNull();
  });

  // ---------------- listByUser ----------------

  it('listByUser returns user own tokens, scoped', async () => {
    await svc.create(u1Id, 't1');
    await svc.create(u1Id, 't2');
    await svc.create(u2Id, 't3');
    const list = await svc.listByUser(u1Id);
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name).sort()).toEqual(['t1', 't2']);
  });

  // ---------------- revoke ----------------

  it('revoke sets revokedAt', async () => {
    const r = await svc.create(u1Id, 'demo');
    await svc.revoke(u1Id, r.record.id);
    const after = await prisma.apiToken.findUnique({ where: { id: r.record.id } });
    expect(after?.revokedAt).not.toBeNull();
  });

  it('revoke is idempotent', async () => {
    const r = await svc.create(u1Id, 'demo');
    await svc.revoke(u1Id, r.record.id);
    await expect(svc.revoke(u1Id, r.record.id)).resolves.toBeUndefined();
  });

  it('revoke cross-user is rejected', async () => {
    const r = await svc.create(u1Id, 'demo');
    await expect(svc.revoke(u2Id, r.record.id)).rejects.toThrow('not_found');
  });
});
