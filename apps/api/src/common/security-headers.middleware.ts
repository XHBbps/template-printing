import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // 每个响应带一个请求 ID，供前端错误页 / 排障关联（X-Request-Id）
    res.setHeader('X-Request-Id', randomUUID());
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://*.feishu.cn https://*.larksuite.com https://*.feishucdn.com https://*.larksuitecdn.com",
        "connect-src 'self' https://open.feishu.cn https://passport.feishu.cn",
        "frame-ancestors 'self' https://*.feishu.cn https://*.larksuite.com",
        "base-uri 'self'",
      ].join('; '),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  }
}
