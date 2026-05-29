import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlSeconds: number,
  ) {}

  async create(userId: string): Promise<{ plaintext: string; id: string }> {
    const plaintext = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const row = await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return { plaintext, id: row.id };
  }

  async verify(plaintext: string): Promise<{ userId: string; id: string } | null> {
    if (!/^[0-9a-f]{64}$/.test(plaintext)) return null;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return { userId: row.userId, id: row.id };
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /**
   * 原子吊销:仅当该 token 仍未吊销时翻转,返回是否本调用赢得吊销(count===1)。
   * 用于 refresh 轮换防分叉——同一 token 并发两次 refresh,只有赢得 CAS 的请求才继续签发新会话,
   * 输家(count===0)说明 token 已被并发请求消费,不得再 create 第二套会话。
   */
  async revokeIfActive(id: string): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
