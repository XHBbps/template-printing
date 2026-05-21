import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;

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
