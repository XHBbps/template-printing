import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { validateEnv } from '../src/common/env.js';
// eslint-disable-next-line import/no-unresolved
import { HealthModule } from '../src/health/health.module.js';
// eslint-disable-next-line import/no-unresolved
import { configureApp } from '../src/main.js';

describe('CORS env allowlist (V4)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Set allowlist BEFORE bootstrap; configureApp reads validated env.
    process.env.CORS_ORIGIN = 'http://localhost:5173,http://localhost:4173';
    const env = validateEnv();

    const module: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects disallowed origin (no ACAO header echoed for evil.example)', async () => {
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'https://evil.example')
      .expect(200);
    const acao = res.headers['access-control-allow-origin'];
    // 不能回显恶意来源,也不能是 '*'
    expect(acao === 'https://evil.example' || acao === '*').toBe(false);
  });

  it('allows configured origin localhost:5173 with credentials', async () => {
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows second configured origin localhost:4173 with credentials', async () => {
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'http://localhost:4173')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('serves requests without Origin header (same-origin / curl) normally', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.body.ok).toBe(true);
    // 无 Origin 时不应有 ACAO 头
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
