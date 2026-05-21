import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../jwt/jwt.service.js';

export interface AuthenticatedRequest extends Request {
  user?: JwtClaims;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);
