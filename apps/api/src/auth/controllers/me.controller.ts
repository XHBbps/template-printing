import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Req,
  UnauthorizedException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../../audit/audit-log.service.js';
// eslint-disable-next-line import/no-unresolved
import { isInternal } from '../account-kind.js';
// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../jwt/jwt.service.js';

export interface MeResponse {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user' | 'emergency_admin';
  mustChangePassword: boolean;
  larkUserId: string | null;
  localUsername: string | null;
  hasLocalPassword: boolean;
  mobile: string | null;
  externalCode: string | null;
  isInternal: boolean;
  csrf: string;
}

const SetPasswordDtoSchema = z.object({
  newPassword: z.string().min(8).max(72),
  // Required if user already has a localPasswordHash (changing password vs. setting first time)
  currentPassword: z.string().optional(),
});

const UpdateProfileDtoSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    // 空字符串 → 清空邮箱(null);非空须为合法 email
    email: z.union([z.literal(''), z.string().trim().email().max(254)]).optional(),
  })
  .refine((d) => d.name !== undefined || d.email !== undefined, {
    message: 'no_fields_to_update',
  });

@Controller('users')
export class MeController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditLogService,
  ) {}

  @Get('me')
  async me(@CurrentUser() jwt: JwtClaims): Promise<{ ok: true; user: MeResponse }> {
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new NotFoundException('User not found');
    return {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role as MeResponse['role'],
        mustChangePassword: user.mustChangePassword,
        larkUserId: user.larkUserId,
        localUsername: user.localUsername,
        hasLocalPassword: Boolean(user.localPasswordHash),
        mobile: user.mobile,
        externalCode: user.externalCode,
        isInternal: isInternal(user),
        csrf: jwt.csrf,
      },
    };
  }

  @Patch('me/profile')
  async updateProfile(
    @CurrentUser() jwt: JwtClaims,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const dto = UpdateProfileDtoSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new UnauthorizedException();
    const data: { name?: string; email?: string | null } = {};
    if (dto.name !== undefined) {
      if (isInternal(user)) throw new BadRequestException('internal_profile_readonly');
      data.name = dto.name;
    }
    if (dto.email !== undefined) {
      if (isInternal(user)) throw new BadRequestException('internal_profile_readonly');
      data.email = dto.email === '' ? null : dto.email;
    }
    await this.prisma.user.update({ where: { id: jwt.sub }, data });
    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: 'user.profile.update',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        ...(dto.name !== undefined ? { oldName: user.name, newName: dto.name } : {}),
        ...(dto.email !== undefined ? { oldEmail: user.email, newEmail: data.email } : {}),
      },
      request: req,
    });
    return { ok: true };
  }

  @Patch('me/password')
  async setPassword(@CurrentUser() jwt: JwtClaims, @Body() rawBody: unknown, @Req() req: Request) {
    const dto = SetPasswordDtoSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new UnauthorizedException();
    if (!user.localPasswordHash) throw new BadRequestException('no_local_password');
    if (!dto.currentPassword) throw new BadRequestException('current_password_required');
    const ok = await bcrypt.compare(dto.currentPassword, user.localPasswordHash);
    if (!ok) throw new BadRequestException('current_password_incorrect');
    const hash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: jwt.sub },
      data: { localPasswordHash: hash, mustChangePassword: false },
    });
    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: 'user.password.change',
      resourceType: 'user',
      resourceId: user.id,
      request: req,
    });
    return { ok: true };
  }
}
