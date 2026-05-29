import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { HttpException } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { RenderService } from '../src/render/render.service.js';

/**
 * 批次8 P3：日配额计数 Redis 缓存（fail-open 回 DB）单测。
 *
 * 路径选择：聚焦单测而非 e2e。真实入队需鉴权 + 模板 + 队列 + 真实 Redis/DB，
 * 过重；而本次改动的核心逻辑（缓存命中 / miss + SETEX / Redis 错误 fail-open）
 * 全部集中在 dailyUsed，依赖面仅 this.redis + this.prisma，
 * 直接 stub 这两者即可精确覆盖三条分支。配额超限（429）经 checkDailyQuota
 * 验证缓存计数确实驱动限流。
 */

type FakeRedis = {
  get: jest.Mock<(key: string) => Promise<string | null>>;
  set: jest.Mock<(...args: unknown[]) => Promise<string>>;
};

type FakePrisma = {
  renderJob: { count: jest.Mock<(...args: unknown[]) => Promise<number>> };
};

type CountMock = jest.Mock<(...args: unknown[]) => Promise<number>>;

/** 构造一个仅依赖 redis + prisma stub 的 RenderService（绕过真实连接）。 */
function makeService(redis: FakeRedis, prismaCount: CountMock): RenderService {
  // 用裸对象 + 原型挂载私有方法，避免构造函数里 new IORedis/Queue 产生真实连接句柄
  const prisma: FakePrisma = { renderJob: { count: prismaCount } };
  const svc = Object.create(RenderService.prototype) as RenderService;
  Object.assign(svc, { prisma, redis });
  return svc;
}

// 访问私有方法的辅助（保持类型干净）
function callDailyUsed(svc: RenderService, ownerId: string, start: Date): Promise<number> {
  return (
    svc as unknown as {
      dailyUsed(ownerId: string, start: Date): Promise<number>;
    }
  ).dailyUsed(ownerId, start);
}

function callCheckQuota(svc: RenderService, ownerId: string): Promise<void> {
  return (
    svc as unknown as {
      checkDailyQuota(ownerId: string): Promise<void>;
    }
  ).checkDailyQuota(ownerId);
}

describe('RenderService 日配额缓存（dailyUsed）', () => {
  const start = new Date('2026-05-29T00:00:00');

  let redis: FakeRedis;
  let prismaCount: CountMock;

  beforeEach(() => {
    redis = {
      get: jest.fn<(key: string) => Promise<string | null>>(),
      set: jest.fn<(...args: unknown[]) => Promise<string>>(async () => 'OK'),
    };
    prismaCount = jest.fn<(...args: unknown[]) => Promise<number>>(async () => 0);
  });

  it('缓存命中：GET 返回数字字符串 → 直接用，不查 DB', async () => {
    redis.get.mockResolvedValueOnce('5');
    const svc = makeService(redis, prismaCount);

    const used = await callDailyUsed(svc, 'owner-1', start);

    expect(used).toBe(5);
    expect(prismaCount).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('缓存 miss：GET 返回 null → 跑 DB count 并 SETEX 至当日午夜', async () => {
    redis.get.mockResolvedValueOnce(null);
    prismaCount.mockResolvedValueOnce(7);
    const svc = makeService(redis, prismaCount);

    const used = await callDailyUsed(svc, 'owner-2', start);

    expect(used).toBe(7);
    expect(prismaCount).toHaveBeenCalledTimes(1);
    // SETEX：key 含 owner + 当日日期，值=count，EX + 正整数 TTL
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, exFlag, ttl] = redis.set.mock.calls[0] as [string, number, string, number];
    // 期望 key 用与被测代码同款构造动态算（start.toISOString() 是 UTC 切片），
    // 避免在 UTC+ 时区 / TZ 不固定的 CI 下硬编码日期段失配。
    expect(key).toBe(`render-quota:owner-2:${start.toISOString().slice(0, 10)}`);
    expect(value).toBe(7);
    expect(exFlag).toBe('EX');
    expect(typeof ttl).toBe('number');
    expect(ttl).toBeGreaterThanOrEqual(1);
  });

  it('fail-open：redis.get 抛错 → 回退 DB count，不抛', async () => {
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    prismaCount.mockResolvedValueOnce(42);
    const svc = makeService(redis, prismaCount);

    const used = await callDailyUsed(svc, 'owner-3', start);

    expect(used).toBe(42);
    expect(prismaCount).toHaveBeenCalledTimes(1);
  });

  it('fail-open：redis.set 抛错（miss 写缓存失败）→ 仍返回 DB count，不抛', async () => {
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    // try 块先 count 一次（拿到 3），set 抛错进 catch 后 fail-open 再 count 一次
    // → 用 mockResolvedValue 让两次都返回 3，断言才有意义
    prismaCount.mockResolvedValue(3);
    const svc = makeService(redis, prismaCount);

    const used = await callDailyUsed(svc, 'owner-4', start);

    expect(used).toBe(3);
    // 进入 catch 后 fail-open 又 count 一次（共 2 次）
    expect(prismaCount).toHaveBeenCalledTimes(2);
  });
});

describe('RenderService checkDailyQuota（缓存计数驱动限流）', () => {
  let redis: FakeRedis;
  let prismaCount: CountMock;

  beforeEach(() => {
    redis = {
      get: jest.fn<(key: string) => Promise<string | null>>(),
      set: jest.fn<(...args: unknown[]) => Promise<string>>(async () => 'OK'),
    };
    prismaCount = jest.fn<(...args: unknown[]) => Promise<number>>(async () => 0);
  });

  it('缓存计数已达上限 → 抛 429 QUOTA_EXCEEDED（含 used/limit/resetAt）', async () => {
    process.env.RENDER_QUOTA_PER_USER_DAILY = '3';
    redis.get.mockResolvedValueOnce('3'); // 缓存显示已用满
    const svc = makeService(redis, prismaCount);
    // checkDailyQuota 走 renderQuotaExceeded.inc()，注入最小 metrics stub
    Object.assign(svc, { metrics: { renderQuotaExceeded: { inc: jest.fn() } } });

    await expect(callCheckQuota(svc, 'owner-q')).rejects.toMatchObject({
      status: 429,
    });

    try {
      await callCheckQuota(svc, 'owner-q');
    } catch (e) {
      const body = (e as HttpException).getResponse() as {
        error: { code: string; used: number; limit: number; resetAt: string };
      };
      expect(body.error.code).toBe('QUOTA_EXCEEDED');
      expect(body.error.used).toBe(3);
      expect(body.error.limit).toBe(3);
      expect(typeof body.error.resetAt).toBe('string');
    }
  });

  it('缓存计数低于上限 → 不抛', async () => {
    process.env.RENDER_QUOTA_PER_USER_DAILY = '10';
    redis.get.mockResolvedValue('2');
    const svc = makeService(redis, prismaCount);
    Object.assign(svc, { metrics: { renderQuotaExceeded: { inc: jest.fn() } } });

    await expect(callCheckQuota(svc, 'owner-ok')).resolves.toBeUndefined();
  });

  it('limit=0（关闭配额）→ 直接放行，不查缓存/不查 DB', async () => {
    process.env.RENDER_QUOTA_PER_USER_DAILY = '0';
    const svc = makeService(redis, prismaCount);
    Object.assign(svc, { metrics: { renderQuotaExceeded: { inc: jest.fn() } } });

    await expect(callCheckQuota(svc, 'owner-off')).resolves.toBeUndefined();
    expect(redis.get).not.toHaveBeenCalled();
    expect(prismaCount).not.toHaveBeenCalled();
  });
});
