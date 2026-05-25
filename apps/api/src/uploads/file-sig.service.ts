import { createHmac, timingSafeEqual } from 'crypto';

// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';

/**
 * HMAC-SHA256 文件签名服务 — 防 /uploads/render/* 输出被未授权下载。
 *
 * Token 格式：`<hex hmac>.<expiryUnix>`，附在 URL 上：
 *   /uploads/render/abc-123.pdf?token=<hex>.<unix>
 *
 * 使用方式：
 *   sign('abc-123.pdf')             — 默认 24h TTL
 *   sign('abc-123.pdf', 60 * 60)    — 自定义 1h TTL
 *   verify('abc-123.pdf', token)    — 返 true/false
 *
 * 注意：HMAC 输入包含完整文件名（含扩展名），避免攻击者用同 jobId 的另一格式 token 互换。
 */
@Injectable()
export class FileSigService {
  private readonly secret: string;
  private readonly defaultTtlSec: number;

  constructor() {
    const sec = process.env.FILE_SIG_SECRET;
    if (!sec || sec.length < 32) {
      throw new Error('FILE_SIG_SECRET must be set and >= 32 chars');
    }
    this.secret = sec;
    const ttl = Number(process.env.FILE_SIG_TTL_SEC ?? 86400);
    this.defaultTtlSec = Number.isFinite(ttl) && ttl > 0 ? ttl : 86400;
  }

  sign(filename: string, ttlSec?: number): string {
    const expiry = Math.floor(Date.now() / 1000) + (ttlSec ?? this.defaultTtlSec);
    const hmac = this.computeHmac(filename, expiry);
    return `${hmac}.${expiry}`;
  }

  verify(filename: string, token: string | undefined | null): boolean {
    if (!token || typeof token !== 'string') return false;
    const dotIdx = token.indexOf('.');
    if (dotIdx <= 0 || dotIdx === token.length - 1) return false;
    const providedHmac = token.slice(0, dotIdx);
    const expiryStr = token.slice(dotIdx + 1);
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry)) return false;
    // 过期检查
    if (expiry < Math.floor(Date.now() / 1000)) return false;
    // HMAC 检查（timing-safe）
    const expected = this.computeHmac(filename, expiry);
    if (providedHmac.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(providedHmac, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * 把不带 token 的相对 URL（/uploads/render/<id>.pdf）拼上 ?token=...，
   * 返完整 URL 字符串；null/empty 输入返 null。
   */
  signUrl(url: string | null | undefined, ttlSec?: number): string | null {
    if (!url) return null;
    const m = url.match(/^\/uploads\/render\/([^/?]+)$/);
    if (!m) return url; // 非 render 输出，原样返
    const filename = m[1] ?? '';
    const token = this.sign(filename, ttlSec);
    return `${url}?token=${token}`;
  }

  private computeHmac(filename: string, expiry: number): string {
    return createHmac('sha256', this.secret).update(`${filename}:${expiry}`).digest('hex');
  }
}
