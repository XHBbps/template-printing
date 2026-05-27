/** 账号双类型判定（纯派生，不依赖任何新增列）。
 * 内部 = 飞书 SSO 账号（有 larkOpenId）∪ 超级管理员（emergency_admin，本地 bootstrap）。
 * 外部 = 其余（管理员创建的本地账号）。 */
export interface AccountKindInput {
  larkOpenId: string | null;
  role: string;
}
export function isInternal(u: AccountKindInput): boolean {
  return u.larkOpenId != null || u.role === 'emergency_admin';
}
export function isExternal(u: AccountKindInput): boolean {
  return !isInternal(u);
}
