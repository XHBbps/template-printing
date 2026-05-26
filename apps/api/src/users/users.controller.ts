import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  BadRequestException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
import type { Request } from 'express';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../audit/audit-log.service.js';
// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { Roles } from '../auth/guards/roles.guard.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../auth/jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { UserStateService } from '../auth/user-state.service.js';

// eslint-disable-next-line import/no-unresolved
import { UsersService } from './users.service.js';

const CreateDto = z.object({
  localUsername: z.string().trim().min(3).max(64),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['user', 'admin']),
  email: z.string().email().optional(),
});

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
  constructor(
    private readonly svc: UsersService,
    private readonly audit: AuditLogService,
    private readonly userState: UserStateService,
  ) {}

  @Get()
  async list(@CurrentUser() me: JwtClaims, @Query() rawQuery: unknown) {
    const parsed = ListQuery.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.list(me.sub, parsed.data);
  }

  @Post()
  async create(@CurrentUser() me: JwtClaims, @Body() rawBody: unknown, @Req() req: Request) {
    const parsed = CreateDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.svc.createLocal(parsed.data);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'user.create',
      resourceType: 'user',
      resourceId: result.user.id,
      details: { localUsername: result.user.localUsername, role: result.user.role },
      request: req,
    });
    return result;
  }

  @Patch(':id/role')
  async changeRole(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const parsed = z.object({ role: z.enum(['user', 'admin']) }).safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const r = await this.svc.changeRole(me.sub, id, parsed.data.role);
    this.userState.evict(id);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'user.role.change',
      resourceType: 'user',
      resourceId: id,
      details: { role: parsed.data.role },
      request: req,
    });
    return r;
  }
}
