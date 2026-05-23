import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UnauthorizedException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

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
  csrf: string;
}

const SetPasswordDtoSchema = z.object({
  newPassword: z.string().min(8).max(72),
  // Required if user already has a localPasswordHash (changing password vs. setting first time)
  currentPassword: z.string().optional(),
});

@Controller('users')
export class MeController {
  constructor(private readonly prisma: PrismaClient) {}

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
        csrf: jwt.csrf,
      },
    };
  }

  @Patch('me/password')
  async setPassword(
    @CurrentUser() jwt: JwtClaims,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true }> {
    const dto = SetPasswordDtoSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new UnauthorizedException();

    if (user.localPasswordHash) {
      if (!dto.currentPassword) throw new BadRequestException('current_password_required');
      const ok = await bcrypt.compare(dto.currentPassword, user.localPasswordHash);
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
    return { ok: true };
  }
}
