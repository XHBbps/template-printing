import {
  Controller,
  Get,
  Query,
  BadRequestException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { Roles } from '../auth/guards/roles.guard.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../auth/jwt/jwt.service.js';

// eslint-disable-next-line import/no-unresolved
import { UsersService } from './users.service.js';

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  role: z.enum(['user', 'admin', 'emergency_admin']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  type: z.enum(['lark', 'local', 'both']).optional(),
});

@Controller('admin/users')
@Roles('admin', 'emergency_admin')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  async list(@CurrentUser() me: JwtClaims, @Query() rawQuery: unknown) {
    const parsed = ListQuery.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.list(me.sub, parsed.data);
  }
}
