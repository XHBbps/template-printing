export const LOGIN_PATH = '/login';
export const HOME_PATH = '/';

export function buildLarkLoginUrl(continueTo?: string): string {
  const sp = new URLSearchParams();
  if (continueTo) sp.set('continue', continueTo);
  const qs = sp.toString();
  return `/api/auth/lark/login${qs ? `?${qs}` : ''}`;
}
