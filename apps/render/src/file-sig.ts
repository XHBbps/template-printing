import { createHmac } from 'crypto';

/**
 * 与 apps/api/src/uploads/file-sig.service.ts 保持完全相同的 HMAC 算法。
 * worker 给外部 callbackUrl 推送 PDF/PNG URL 时调 signUrl 加 token。
 *
 * 共享 env FILE_SIG_SECRET 与 FILE_SIG_TTL_SEC（docker-compose 中由 api +
 * render 同时挂载）。
 */
const SECRET = process.env.FILE_SIG_SECRET ?? '';
const TTL_SEC_RAW = Number(process.env.FILE_SIG_TTL_SEC ?? 86400);
const TTL_SEC = Number.isFinite(TTL_SEC_RAW) && TTL_SEC_RAW > 0 ? TTL_SEC_RAW : 86400;

export function signUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!SECRET || SECRET.length < 32) {
    // 兜底：worker 没拿到 secret 时不签（仅 dev / 测试场景）；warn 一次
    // eslint-disable-next-line no-console
    console.warn('[render] FILE_SIG_SECRET missing or too short — URL not signed');
    return url;
  }
  const m = url.match(/^\/uploads\/render\/([^/?]+)$/);
  if (!m) return url;
  const filename = m[1];
  const expiry = Math.floor(Date.now() / 1000) + TTL_SEC;
  const hmac = createHmac('sha256', SECRET).update(`${filename}:${expiry}`).digest('hex');
  return `${url}?token=${hmac}.${expiry}`;
}
