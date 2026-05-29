// eslint-disable-next-line import/no-unresolved
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

import type { JwtClaims } from '../auth/jwt/jwt.service.js';

interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { user?: JwtClaims }>();

    let status = 500;
    let body: ApiErrorBody = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      let code = this.statusToCode(status);
      let message: string;
      let details: Record<string, unknown> | undefined;
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object') {
        const obj = resp as Record<string, unknown>;
        // 自定义错误码(如 { code: 'MUST_CHANGE_PASSWORD' })→ 透传到 error.code
        if (typeof obj.code === 'string') code = obj.code;
        if (typeof obj.message === 'string') {
          message = obj.message;
        } else {
          // 无字符串 message 的 object 形态(典型:zod flatten { formErrors, fieldErrors })→
          // 完整放进 details,前端据此拿字段级错误,而非只见笼统 "Bad Request"。
          message = exception.message;
          details = obj;
        }
      } else {
        message = exception.message;
      }
      body = {
        ok: false,
        error: { code, message, ...(details ? { details } : {}) },
      };
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    } else {
      this.logger.error(`Unhandled non-error throw: ${JSON.stringify(exception)}`);
    }

    // iter 32 T2：5xx + 未知错误上报 Sentry（4xx 已在 instrument.ts beforeSend 过滤）
    if (status >= 500 || !(exception instanceof HttpException)) {
      Sentry.withScope((scope) => {
        scope.setTag('url', request.url);
        scope.setTag('method', request.method);
        if (request.user?.sub) {
          scope.setUser({ id: request.user.sub, role: request.user.role });
        }
        scope.setContext('request', {
          method: request.method,
          url: request.url,
          ip: request.ip,
        });
        Sentry.captureException(exception);
      });
    }

    response.status(status).json(body);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
      502: 'UPSTREAM_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
