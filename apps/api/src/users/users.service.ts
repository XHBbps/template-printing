import { randomBytes } from 'node:crypto';

// eslint-disable-next-line import/no-unresolved
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface ListArgs {
  page: number;
  pageSize: number;
  search?: string;
  role?: 'user' | 'admin' | 'emergency_admin';
  status?: 'active' | 'disabled';
  type?: 'lark' | 'local' | 'both';
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
    if (args.type === 'lark') where.larkOpenId = { not: null };
    if (args.type === 'local') where.localPasswordHash = { not: null };
    if (args.type === 'both')
      where.AND = [{ larkOpenId: { not: null } }, { localPasswordHash: { not: null } }];

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
      const accountType: 'lark' | 'local' | 'both' =
        hasLarkBinding && hasLocalPassword ? 'both' : hasLarkBinding ? 'lark' : 'local';
      const accountLabel =
        accountType === 'both' ? '飞书+本地' : accountType === 'lark' ? '飞书' : '本地';
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
      select: { id: true, role: true },
    });
    if (!target) throw new ForbiddenException('user_not_found');
    if (target.role === 'emergency_admin')
      throw new ForbiddenException('emergency_admin_protected');
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

  async createLocal(input: {
    localUsername: string;
    name: string;
    role: 'user' | 'admin';
    email?: string;
  }) {
    const exists = await this.prisma.user.findUnique({
      where: { localUsername: input.localUsername },
      select: { id: true },
    });
    if (exists) throw new ConflictException('username_taken');
    const plaintext = randomBytes(9).toString('base64url'); // ~12 chars
    const user = await this.prisma.user.create({
      data: {
        localUsername: input.localUsername,
        name: input.name,
        email: input.email ?? null,
        role: input.role,
        localPasswordHash: await bcrypt.hash(plaintext, 12),
        mustChangePassword: true,
      },
      select: { id: true, localUsername: true, name: true, role: true, email: true },
    });
    return { plaintext, user };
  }
}
