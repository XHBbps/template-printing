import { describe, it, expect, jest } from '@jest/globals';
import { ArgumentsHost, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { GlobalExceptionFilter } from '../src/common/exception.filter.js';

interface CapturedBody {
  ok: boolean;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

function mockHost(): { host: ArgumentsHost; getBody: () => CapturedBody; getStatus: () => number } {
  let captured: CapturedBody = { ok: false, error: { code: '', message: '' } };
  let statusCode = 0;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(b: CapturedBody) {
      captured = b;
      return this;
    },
  } as unknown as Response;
  const req = { url: '/x', method: 'POST', ip: '127.0.0.1' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, getBody: () => captured, getStatus: () => statusCode };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  it('zod flatten 形态的 400 → 完整内容进 error.details(前端拿字段级错误)', () => {
    const flat = z.object({ name: z.string().min(1) }).safeParse({ name: '' });
    expect(flat.success).toBe(false);
    const { host, getBody, getStatus } = mockHost();

    filter.catch(new BadRequestException((flat as { error: z.ZodError }).error.flatten()), host);

    expect(getStatus()).toBe(400);
    const body = getBody();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details).toBeDefined();
    expect(body.error.details).toHaveProperty('fieldErrors');
  });

  it('自定义 { code, message } → 透传 error.code', () => {
    const { host, getBody, getStatus } = mockHost();
    filter.catch(
      new ForbiddenException({ code: 'MUST_CHANGE_PASSWORD', message: '请先改密' }),
      host,
    );
    expect(getStatus()).toBe(403);
    const body = getBody();
    expect(body.error.code).toBe('MUST_CHANGE_PASSWORD');
    expect(body.error.message).toBe('请先改密');
    expect(body.error.details).toBeUndefined();
  });

  it('字符串 message 的标准异常 → message 原样、无 details', () => {
    const { host, getBody } = mockHost();
    filter.catch(new BadRequestException('no_local_password'), host);
    const body = getBody();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('no_local_password');
    expect(body.error.details).toBeUndefined();
  });

  it('未知错误 → 500 INTERNAL_ERROR(消息不泄露内部细节)', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, getBody, getStatus } = mockHost();
    filter.catch(new Error('boom internal'), host);
    expect(getStatus()).toBe(500);
    const body = getBody();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    errSpy.mockRestore();
  });
});
