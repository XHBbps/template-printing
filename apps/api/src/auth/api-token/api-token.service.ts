import * as crypto from 'crypto';

// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../../prisma/prisma.service.js';

const TOKEN_PREFIX = 'tpkn_';
const RANDOM_BYTES = 16; // → 32 hex chars
const PREFIX_DISPLAY_LEN = TOKEN_PREFIX.length + 8; // 'tpkn_' + 8 chars

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreatedToken {
  plaintext: string;
  record: ApiTokenSummary;
}

export interface VerifiedToken {
  id: string;
  role: string;
}

@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 生成新明文 token，形如 tpkn_<32 hex>。仅供内部使用 */
  static generatePlaintext(): string {
    return TOKEN_PREFIX + crypto.randomBytes(RANDOM_BYTES).toString('hex');
  }

  static hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }

  static getPrefix(plaintext: string): string {
    return plaintext.slice(0, PREFIX_DISPLAY_LEN);
  }

  /** 为用户创建一个 token，明文仅这一次返回 */
  async create(userId: string, name: string): Promise<CreatedToken> {
    const plaintext = ApiTokenService.generatePlaintext();
    const tokenHash = ApiTokenService.hash(plaintext);
    const prefix = ApiTokenService.getPrefix(plaintext);

    const row = await this.prisma.apiToken.create({
      data: { userId, name, tokenHash, prefix },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return { plaintext, record: row };
  }

  /** 列出某用户的 token（含已吊销，前端可灰显） */
  async listByUser(userId: string): Promise<ApiTokenSummary[]> {
    return this.prisma.apiToken.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
  }

  /**
   * 验证明文 token，返回关联用户 + role；不存在 / 已吊销 → null。
   * 副作用：异步更新 lastUsedAt（不阻塞调用方）。
   */
  async verify(plaintext: string): Promise<VerifiedToken | null> {
    if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = ApiTokenService.hash(plaintext);

    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true, disabledAt: true } } },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.user.disabledAt) return null; // owner 被禁用 → 拒绝

    // 异步更新 lastUsedAt（fire-and-forget）— 不影响响应时延
    this.prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((e) => this.logger.warn(`failed to update lastUsedAt: ${(e as Error).message}`));

    return { id: row.user.id, role: row.user.role };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 软删（设 revokedAt）。检查 userId 拥有该 token */
  async revoke(userId: string, tokenId: string): Promise<void> {
    const row = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: { userId: true, revokedAt: true },
    });
    if (!row || row.userId !== userId) {
      // 抛 NotFound 而非 Forbidden — 不泄露 token 存在性
      throw new Error('not_found');
    }
    if (row.revokedAt) return; // 已吊销 idempotent
    await this.prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }
}
