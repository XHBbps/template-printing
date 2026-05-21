import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { HealthModule } from '../src/health/health.module.js';

describe('GET /healthz', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with ok=true and version', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.version).toBe('string');
  });
});
