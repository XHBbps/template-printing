import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { StatsService } from '../src/stats/stats.service.js';

// percentile_cont(0.5) 的线性插值参照实现(用于交叉校验,与 SQL 口径一致)
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * 0.5;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

describe('GET /stats/overview', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const OWNER = 'e2e_stats_owner';
  let templateId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: OWNER } });
    const owner = await prisma.user.create({
      data: { localUsername: OWNER, role: 'user', name: 'Stats Owner' },
    });
    const tpl = await prisma.template.create({
      data: { name: 'e2e stats tpl', data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;
    const now = Date.now();
    await prisma.renderJob.createMany({
      data: [
        {
          templateId,
          data: {},
          formats: ['pdf'],
          status: 'done',
          startedAt: new Date(now - 10000),
          completedAt: new Date(now - 9000),
        },
        {
          templateId,
          data: {},
          formats: ['pdf'],
          status: 'done',
          startedAt: new Date(now - 10000),
          completedAt: new Date(now - 8000),
        },
        {
          templateId,
          data: {},
          formats: ['pdf'],
          status: 'done',
          startedAt: new Date(now - 10000),
          completedAt: new Date(now - 7000),
        },
        { templateId, data: {}, formats: ['pdf'], status: 'failed' },
        { templateId, data: {}, formats: ['pdf'], status: 'pending' },
      ],
    });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { localUsername: OWNER } });
    await prisma.$disconnect();
    await app.close();
  });

  it('computeOverview matches an independent reference over the live DB', async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const svc = new StatsService(prisma as never);
    const out = await svc.computeOverview(since);

    const refMonthly = await prisma.renderJob.count({ where: { createdAt: { gte: since } } });
    const refDone = await prisma.renderJob.count({
      where: { createdAt: { gte: since }, status: 'done' },
    });
    const refFailed = await prisma.renderJob.count({
      where: { createdAt: { gte: since }, status: 'failed' },
    });
    const doneRows = await prisma.renderJob.findMany({
      where: {
        createdAt: { gte: since },
        status: 'done',
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: { startedAt: true, completedAt: true },
    });
    const durations = doneRows.map((j) => j.completedAt!.getTime() - j.startedAt!.getTime());
    const refP50 = median(durations);
    const denom = refDone + refFailed;

    expect(out.windowDays).toBe(30);
    expect(out.monthlyRenders).toBe(refMonthly);
    expect(out.successRate).toBe(denom === 0 ? null : refDone / denom);
    if (refP50 === null) expect(out.p50LatencyMs).toBeNull();
    else expect(Math.abs((out.p50LatencyMs as number) - Math.round(refP50))).toBeLessThanOrEqual(2);
  });

  it('empty window → 0 / null / null', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const svc = new StatsService(prisma as never);
    const out = await svc.computeOverview(future);
    expect(out.monthlyRenders).toBe(0);
    expect(out.p50LatencyMs).toBeNull();
    expect(out.successRate).toBeNull();
  });

  it('GET /stats/overview is public (200 without auth) and well-shaped', async () => {
    const res = await request(app.getHttpServer()).get('/stats/overview').expect(200);
    expect(res.body.windowDays).toBe(30);
    expect(typeof res.body.monthlyRenders).toBe('number');
    expect('p50LatencyMs' in res.body).toBe(true);
    expect('successRate' in res.body).toBe(true);
  });
});
