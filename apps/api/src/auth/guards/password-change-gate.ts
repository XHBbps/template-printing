import {
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Reflector } from '@nestjs/core';

export const ALLOW_DURING_PASSWORD_CHANGE_KEY = 'allowDuringPasswordChange';

/**
 * 标记:即使 `mustChangePassword=true` 也放行的端点(读 me / 改密)。
 * 登出 / 续签走 `@Public()` 天然不经过本闸,无需此标记。
 */
export const AllowDuringPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DURING_PASSWORD_CHANGE_KEY, true);

/**
 * 强制改密后端闸:用户 `mustChangePassword=true` 时,除白名单端点(读 me / 改密)外一律 403。
 *
 * 在已注入 `req.user` 的鉴权 guard 内调用(JwtAuthGuard cookie 路径 / ApiAuthGuard 双路径),
 * 堵住"前端仅软拦截、后端仍签发完整有效 token"导致的绕过:拿到初始/重置密码的用户
 * 可不走前端弹窗直接调任意业务 API(含创建长期 API token)。`mustChangePassword` 取自
 * 每请求的 DB 状态(UserStateService / token 校验),与 role 覆盖机制一致。
 */
export function assertPasswordChanged(
  reflector: Reflector,
  ctx: ExecutionContext,
  mustChangePassword: boolean | undefined,
): void {
  if (!mustChangePassword) return;
  const allowed = reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE_KEY, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);
  if (allowed) return;
  throw new ForbiddenException({
    code: 'MUST_CHANGE_PASSWORD',
    message: '请先修改初始密码后再继续操作',
  });
}
