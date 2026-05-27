import { randomBytes } from 'node:crypto';

// eslint-disable-next-line import/no-unresolved
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

// eslint-disable-next-line import/no-unresolved
import { isExternal, isInternal } from '../auth/account-kind.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

/** Advisory lock ID for externalCode 序号分配；须在本代码库 pg_advisory_xact_lock 调用中唯一。 */
const EXTERNAL_CODE_LOCK_ID = 1234567890;

export interface ListArgs {
  page: number;
  pageSize: number;
  search?: string;
  role?: 'user' | 'admin' | 'emergency_admin';
  status?: 'active' | 'disabled';
  type?: 'internal' | 'external';
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meId: string, args: ListArgs) {
    const page = Math.max(args.page, 1);
    const pageSize = Math.min(Math.max(args.pageSize, 1), 100);
    const where: Prisma.UserWhereInput = {};
    if (args.search) {
      const q = args.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { localUsername: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { larkUserId: { contains: q } },
      ];
    }
    if (args.role) where.role = args.role;
    if (args.status === 'active') where.disabledAt = null;
    if (args.status === 'disabled') where.disabledAt = { not: null };
    if (args.type === 'internal') {
      // Use AND accumulation so an existing search OR is not clobbered
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND != null ? [where.AND] : []),
        { OR: [{ larkOpenId: { not: null } }, { role: 'emergency_admin' }] },
      ];
    }
    if (args.type === 'external') {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND != null ? [where.AND] : []),
        { larkOpenId: null },
        { role: { not: 'emergency_admin' } },
      ];
    }

    const [rows, total, activeAdminCount] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          localUsername: true,
          larkUserId: true,
          larkOpenId: true,
          externalCode: true,
          localPasswordHash: true,
          disabledAt: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { role: 'admin', disabledAt: null } }),
    ]);

    const items = rows.map((u) => {
      const hasLarkBinding = u.larkOpenId != null;
      const hasLocalPassword = u.localPasswordHash != null;
      const accountType: 'internal' | 'external' = isInternal(u) ? 'internal' : 'external';
      const accountLabel = accountType === 'internal' ? '内部' : '外部';
      const isSelf = u.id === meId;
      const isEmergency = u.role === 'emergency_admin';
      const isLastAdmin = u.role === 'admin' && u.disabledAt == null && activeAdminCount <= 1;
      let disabledReason: string | null = null;
      if (isEmergency) disabledReason = 'emergency_admin_protected';
      else if (isSelf) disabledReason = 'cannot_modify_self';
      else if (isLastAdmin) disabledReason = 'last_admin_protected';
      const blocked = isSelf || isEmergency || isLastAdmin;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        localUsername: u.localUsername,
        larkUserId: u.larkUserId,
        externalCode: u.externalCode,
        hasLocalPassword,
        hasLarkBinding,
        accountType,
        accountLabel,
        disabled: u.disabledAt != null,
        can: {
          disable: !blocked,
          changeRole: !blocked,
          resetPassword: hasLocalPassword && !isEmergency,
        },
        disabledReason,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      };
    });
    return { items, total, page, pageSize };
  }

  async changeRole(meId: string, targetId: string, role: 'user' | 'admin') {
    if (targetId === meId) throw new ForbiddenException('cannot_modify_self');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, larkOpenId: true },
    });
    if (!target) throw new ForbiddenException('user_not_found');
    if (target.role === 'emergency_admin')
      throw new ForbiddenException('emergency_admin_protected');
    if (role === 'admin' && isExternal(target))
      throw new ForbiddenException('external_cannot_be_admin');
    if (target.role === role) return { id: targetId, role };

    await this.prisma.$transaction(async (tx) => {
      if (target.role === 'admin' && role === 'user') {
        const admins = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE`;
        const remaining = admins.filter((a) => a.id !== targetId).length;
        if (remaining < 1) throw new ConflictException('last_admin_protected');
      }
      await tx.user.update({ where: { id: targetId }, data: { role } });
    });
    return { id: targetId, role };
  }

  async setDisabled(meId: string, targetId: string, disabled: boolean) {
    if (disabled && targetId === meId) throw new ForbiddenException('cannot_modify_self');
    const t = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!t) throw new ForbiddenException('user_not_found');
    if (disabled && t.role === 'emergency_admin')
      throw new ForbiddenException('emergency_admin_protected');
    await this.prisma.$transaction(async (tx) => {
      if (disabled && t.role === 'admin' && t.disabledAt == null) {
        const admins = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE`;
        if (admins.filter((a) => a.id !== targetId).length < 1)
          throw new ConflictException('last_admin_protected');
      }
      await tx.user.update({
        where: { id: targetId },
        data: { disabledAt: disabled ? new Date() : null },
      });
    });
    return { id: targetId, disabled };
  }

  async resetPassword(targetId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, localPasswordHash: true },
    });
    if (!u) throw new ForbiddenException('user_not_found');
    if (u.role === 'emergency_admin') throw new ForbiddenException('emergency_admin_protected');
    if (!u.localPasswordHash) throw new BadRequestException('not_a_local_account');
    const plaintext = randomBytes(9).toString('base64url');
    await this.prisma.user.update({
      where: { id: targetId },
      data: { localPasswordHash: await bcrypt.hash(plaintext, 12), mustChangePassword: true },
    });
    return { plaintext };
  }

  async createLocal(input: { localUsername: string; name: string; email?: string }) {
    const exists = await this.prisma.user.findUnique({
      where: { localUsername: input.localUsername },
      select: { id: true },
    });
    if (exists) throw new ConflictException('username_taken');
    const plaintext = randomBytes(9).toString('base64url'); // ~12 chars
    // 在事务外完成 bcrypt (~200ms)，避免持锁期间占用 DB 连接
    const hash = await bcrypt.hash(plaintext, 12);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // 使用 advisory lock 避免并发时 MAX 聚合与 FOR UPDATE 冲突
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EXTERNAL_CODE_LOCK_ID})`;
        const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
          SELECT MAX(CAST(SUBSTRING(external_code FROM 2) AS INTEGER)) AS max
          FROM users WHERE external_code ~ '^W[0-9]+$'`;
        const next = (rows[0]!.max ?? 0) + 1;
        const externalCode = `W${String(next).padStart(8, '0')}`;
        return tx.user.create({
          data: {
            localUsername: input.localUsername,
            name: input.name,
            email: input.email ?? null,
            role: 'user',
            externalCode,
            localPasswordHash: hash,
            mustChangePassword: true,
          },
          select: {
            id: true,
            localUsername: true,
            name: true,
            role: true,
            email: true,
            externalCode: true,
          },
        });
      });
      return { plaintext, user };
    } catch (e) {
      // 并发同名创建：unique 约束兜底 → 409（findUnique 检查存在 check-then-create 竞态）
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('username_taken');
      }
      throw e;
    }
  }
}
