import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  hasLocalPassword: boolean;
  csrf: string;
}

const SetPasswordDtoSchema = z.object({
  newPassword: z.string().min(8).max(72),
  // Required if user already has a localPasswordHash (changing password vs. setting first time)
  currentPassword: z.string().optional(),
});

const UpdateProfileDtoSchema = z.object({
  name: z.string().trim().min(1).max(64),
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
        hasLocalPassword: Boolean(user.localPasswordHash),
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
    await this.prisma.user.update({
      where: { id: jwt.sub },
      data: { name: dto.name },
    });
    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: 'user.profile.update',
      resourceType: 'user',
      resourceId: user.id,
      details: { oldName: user.name, newName: dto.name },
      request: req,
    });
    return { ok: true };
  }

  @Patch('me/password')
  async setPassword(
    @CurrentUser() jwt: JwtClaims,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const dto = SetPasswordDtoSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new UnauthorizedException();

    const wasSet = Boolean(user.localPasswordHash);
    if (wasSet) {
      if (!dto.currentPassword) throw new BadRequestException('current_password_required');
      const ok = await bcrypt.compare(dto.currentPassword, user.localPasswordHash!);
      if (!ok) throw new BadRequestException('current_password_incorrect');
    }
    const hash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: jwt.sub },
      data: {
        localPasswordHash: hash,
        mustChangePassword: false,
        // Ensure localUsername set (in case it was somehow null)
        localUsername: user.localUsername ?? user.larkUserId ?? user.id,
      },
    });
    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: wasSet ? 'user.password.change' : 'user.password.set',
      resourceType: 'user',
      resourceId: user.id,
      request: req,
    });
    return { ok: true };
  }

  @Delete('me/lark-binding')
  async unbindLark(@CurrentUser() jwt: JwtClaims, @Req() req: Request): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new UnauthorizedException();
    // Refuse if user would be left with NO way to log in
    if (!user.localPasswordHash) {
      throw new BadRequestException('set_password_before_unbinding_lark');
    }
    await this.prisma.user.update({
      where: { id: jwt.sub },
      data: {
        larkOpenId: null,
        larkUnionId: null,
        larkUserId: null,
        avatarUrl: null,
      },
    });
    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: 'user.lark.unbind',
      resourceType: 'user',
      resourceId: user.id,
      details: { previousLarkUserId: user.larkUserId },
      request: req,
    });
    return { ok: true };
  }
}
