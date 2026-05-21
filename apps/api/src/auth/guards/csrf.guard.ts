import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line import/no-unresolved
import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;

    // Public endpoints (e.g. login, refresh) don't have an authenticated session yet,
    // so CSRF double-submit can't apply. JwtAuthGuard already short-circuits on @Public,
    // so we mirror that here to avoid blocking unauthenticated POSTs.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const headerToken = (req.headers['x-csrf-token'] ?? req.headers['X-CSRF-Token']) as
      | string
      | undefined;
    const expected = req.user?.csrf;
    if (!expected || !headerToken || headerToken !== expected) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }
    return true;
  }
}
