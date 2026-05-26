# 登录页"假控件/假数据"转真实 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把登录页的"保持登录 30 天"开关接通真实会话语义,并把左侧三个统计指标(月渲染量 / P50 延迟 / 渲染成功率)改为来自真实公开接口。

**Architecture:** Part A —— 在 `jwt-cookie.helper.ts` 实现 `remember` 语义(勾选=持久 cookie,不勾=session cookie),开关从前端经 `LoginBodySchema` 传到 helper;`/auth/refresh` 读 `tp_remember` cookie 延续语义,`/auth/logout` 清理它。Part B —— 新增隔离的 `apps/api/src/stats/` 模块,暴露 `@Public` 的 `GET /stats/overview`,用 `render_jobs` 聚合近 30 天指标(60s 内存缓存);前端 `onMounted` 拉取,失败或无数据一律显示 `—`,不回退硬编码。

**Tech Stack:** NestJS + Prisma(PostgreSQL `percentile_cont`)+ Vue 3 `<script setup>` + Element Plus;测试 jest + supertest(e2e against dev Postgres)。

**Spec:** `docs/superpowers/specs/2026-05-26-login-page-real-data-design.md`

**全局约定(每个 task 都遵守):**
- 容器内跑命令(Windows 宿主 + Docker dev):API 测试/typecheck/lint 在 `template_printing-api` 容器内 `cd /workspace/apps/api` 执行;web 在 `template_printing-web` 容器。例:
  `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- <file>"`
- 提交走 husky 钩子(lint-staged + 签名),**不要** `--no-verify`。
- 只 `git add` 本 task 涉及文件,勿混入工作区其它未跟踪产物。

---

## File Structure

**Part A(保持登录)**
- Modify `apps/api/src/auth/jwt/jwt-cookie.helper.ts` —— 新增 `REMEMBER_COOKIE`、`setAuthCookies` 加 `options.remember`、`clearAuthCookies` 清理 `tp_remember`。
- Modify `apps/api/src/auth/local/local.controller.ts` —— `LoginBodySchema` 加 `remember`;调用传 `{ remember }`。
- Modify `apps/api/src/auth/controllers/auth.controller.ts` —— `refresh_` 读 `tp_remember` 延续;import `REMEMBER_COOKIE`。
- Modify `apps/web/src/views/LoginView.vue` —— `submitLocal` body 加 `remember`。
- Test `apps/api/test/jwt-cookie-helper.spec.ts`(新) —— helper 单元测试。
- Test `apps/api/test/auth-remember.e2e.spec.ts`(新) —— 登录/刷新/登出的 Set-Cookie 语义。

**Part B(三指标)**
- Create `apps/api/src/stats/stats.service.ts` —— 聚合计算 + 60s 缓存。
- Create `apps/api/src/stats/stats.controller.ts` —— `@Public() @Get('overview')`。
- Create `apps/api/src/stats/stats.module.ts` —— controller + service(Prisma 全局可用,无需 imports)。
- Modify `apps/api/src/app.module.ts` —— 注册 `StatsModule`。
- Modify `apps/web/src/views/LoginView.vue` —— 拉取 `/stats/overview` 并格式化展示(移除硬编码)。
- Test `apps/api/test/stats-overview.e2e.spec.ts`(新) —— service 计算交叉校验 + null 路径 + HTTP 公开。

**文档**
- Modify `docs/PROGRESS.md`、`AGENTS.md`。

> 注:`apps/web` 无单元测试 runner(仅 Playwright e2e `apps/web/tests/e2e/`),故前端格式化逻辑内联在组件内,以手测验证(见 Task 6 验证步骤);不为此引入新测试框架(YAGNI)。

---

## Task 1: cookie helper 实现 remember 语义

**Files:**
- Modify: `apps/api/src/auth/jwt/jwt-cookie.helper.ts`
- Test: `apps/api/test/jwt-cookie-helper.spec.ts`(Create)

- [ ] **Step 1: 写失败测试**

Create `apps/api/test/jwt-cookie-helper.spec.ts`:

```ts
import { describe, it, expect } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  setAuthCookies,
  clearAuthCookies,
  type CookieEnv,
} from '../src/auth/jwt/jwt-cookie.helper.js';

type CookieCall = { name: string; value: string; opts: Record<string, unknown> };

function fakeRes() {
  const set: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  const res = {
    set,
    cleared,
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      set.push({ name, value, opts });
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      cleared.push({ name, value: '', opts });
    },
  };
  return res;
}

const ENV: CookieEnv = {
  nodeEnv: 'test',
  cookieDomain: '',
  accessTtlSeconds: 86400,
  refreshTtlSeconds: 2592000,
};

describe('jwt-cookie.helper remember semantics', () => {
  it('remember=true sets maxAge on all three cookies', () => {
    const res = fakeRes();
    setAuthCookies(res as never, ENV, { access: 'a', refresh: 'r' }, { remember: true });
    const byName = Object.fromEntries(res.set.map((c) => [c.name, c]));
    expect(byName[ACCESS_COOKIE].opts.maxAge).toBe(86400 * 1000);
    expect(byName[REFRESH_COOKIE].opts.maxAge).toBe(2592000 * 1000);
    expect(byName[REMEMBER_COOKIE].opts.maxAge).toBe(2592000 * 1000);
    expect(byName[REMEMBER_COOKIE].value).toBe('1');
  });

  it('remember=false omits maxAge (session cookies) and writes 0', () => {
    const res = fakeRes();
    setAuthCookies(res as never, ENV, { access: 'a', refresh: 'r' }, { remember: false });
    const byName = Object.fromEntries(res.set.map((c) => [c.name, c]));
    expect(byName[ACCESS_COOKIE].opts.maxAge).toBeUndefined();
    expect(byName[REFRESH_COOKIE].opts.maxAge).toBeUndefined();
    expect(byName[REMEMBER_COOKIE].opts.maxAge).toBeUndefined();
    expect(byName[REMEMBER_COOKIE].value).toBe('0');
  });

  it('defaults to remember=true when options omitted', () => {
    const res = fakeRes();
    setAuthCookies(res as never, ENV, { access: 'a', refresh: 'r' });
    const byName = Object.fromEntries(res.set.map((c) => [c.name, c]));
    expect(byName[REFRESH_COOKIE].opts.maxAge).toBe(2592000 * 1000);
  });

  it('clearAuthCookies clears all three including tp_remember', () => {
    const res = fakeRes();
    clearAuthCookies(res as never, ENV);
    const names = res.cleared.map((c) => c.name);
    expect(names).toContain(ACCESS_COOKIE);
    expect(names).toContain(REFRESH_COOKIE);
    expect(names).toContain(REMEMBER_COOKIE);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- jwt-cookie-helper"`
Expected: FAIL —— `REMEMBER_COOKIE` 未导出 / `setAuthCookies` 不接收第四参,编译或断言失败。

- [ ] **Step 3: 实现 helper**

Replace the body of `apps/api/src/auth/jwt/jwt-cookie.helper.ts` with:

```ts
import type { Response, CookieOptions } from 'express';

export const ACCESS_COOKIE = 'tp_access';
export const REFRESH_COOKIE = 'tp_refresh';
export const REMEMBER_COOKIE = 'tp_remember';

export interface CookieEnv {
  nodeEnv: string;
  cookieDomain: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

function baseOptions(env: CookieEnv): CookieOptions {
  const isProd = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    // SameSite=None+Secure required for Lark webview iframe; in dev we still
    // set Secure=false because http://localhost serves cookies fine without TLS.
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    domain: env.cookieDomain || undefined,
  };
}

export function setAuthCookies(
  res: Response,
  env: CookieEnv,
  tokens: { access: string; refresh: string },
  options: { remember?: boolean } = {},
): void {
  // remember=true(默认)→ 持久 cookie(带 maxAge);false → session cookie(关浏览器即失效)。
  const remember = options.remember ?? true;
  res.cookie(ACCESS_COOKIE, tokens.access, {
    ...baseOptions(env),
    ...(remember ? { maxAge: env.accessTtlSeconds * 1000 } : {}),
  });
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...baseOptions(env),
    ...(remember ? { maxAge: env.refreshTtlSeconds * 1000 } : {}),
  });
  // 记录 remember 选择,供 /auth/refresh 续签时延续相同语义。
  res.cookie(REMEMBER_COOKIE, remember ? '1' : '0', {
    ...baseOptions(env),
    ...(remember ? { maxAge: env.refreshTtlSeconds * 1000 } : {}),
  });
}

export function clearAuthCookies(res: Response, env: CookieEnv): void {
  res.clearCookie(ACCESS_COOKIE, baseOptions(env));
  res.clearCookie(REFRESH_COOKIE, baseOptions(env));
  res.clearCookie(REMEMBER_COOKIE, baseOptions(env));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- jwt-cookie-helper"`
Expected: PASS(4 个用例)。

- [ ] **Step 5: typecheck**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck"`
Expected: 无错误(`lark.controller.ts` 等既有调用方因第四参可选仍编译通过)。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/auth/jwt/jwt-cookie.helper.ts apps/api/test/jwt-cookie-helper.spec.ts
git commit -m "feat(auth): cookie helper 实现 remember 语义（session vs 30d + tp_remember）"
```

---

## Task 2: 本地登录接收 remember 并据此下发 cookie

**Files:**
- Modify: `apps/api/src/auth/local/local.controller.ts:30-33`(schema)、`:71-72`(调用)
- Test: `apps/api/test/auth-remember.e2e.spec.ts`(Create)

- [ ] **Step 1: 写失败测试**

Create `apps/api/test/auth-remember.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Remember-me cookie semantics e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const USER = 'e2e_remember';
  const PW = 'pw-e2e-remember-1';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USER } });
    await prisma.user.create({
      data: {
        localUsername: USER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'emergency_admin',
        mustChangePassword: false,
        name: 'Remember Test',
      },
    });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USER } });
    await prisma.$disconnect();
    await app.close();
  });

  function setCookieArr(res: request.Response): string[] {
    return res.headers['set-cookie'] as unknown as string[];
  }
  function find(arr: string[], prefix: string): string {
    const c = arr.find((x) => x.startsWith(prefix));
    if (!c) throw new Error(`cookie ${prefix} not found in ${JSON.stringify(arr)}`);
    return c;
  }

  it('remember=true → persistent cookies with Max-Age', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: true })
      .expect(200);
    const arr = setCookieArr(res);
    expect(find(arr, 'tp_access=')).toMatch(/Max-Age=86400/i);
    expect(find(arr, 'tp_refresh=')).toMatch(/Max-Age=2592000/i);
    expect(find(arr, 'tp_remember=')).toMatch(/Max-Age=2592000/i);
    expect(find(arr, 'tp_remember=')).toMatch(/tp_remember=1/);
  });

  it('remember omitted → defaults to persistent (Max-Age present)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW })
      .expect(200);
    expect(find(setCookieArr(res), 'tp_refresh=')).toMatch(/Max-Age=2592000/i);
  });

  it('remember=false → session cookies (no Max-Age / Expires)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: false })
      .expect(200);
    const arr = setCookieArr(res);
    for (const prefix of ['tp_access=', 'tp_refresh=', 'tp_remember=']) {
      const c = find(arr, prefix);
      expect(c).not.toMatch(/Max-Age=/i);
      expect(c).not.toMatch(/Expires=/i);
    }
    expect(find(arr, 'tp_remember=')).toMatch(/tp_remember=0/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- auth-remember"`
Expected: FAIL —— 第 3 个用例失败(当前恒带 Max-Age,且无 `tp_remember` cookie)。

- [ ] **Step 3: 实现 —— 改 schema + 调用**

In `apps/api/src/auth/local/local.controller.ts`,把 `LoginBodySchema` 改为:

```ts
const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional().default(true),
});
```

并把 `setAuthCookies` 调用(当前 `local.controller.ts:72`)改为传 `remember`:

```ts
    setAuthCookies(res, this.cookieEnv, { access, refresh: refreshTok }, { remember: body.remember });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- auth-remember"`
Expected: PASS(3 个用例)。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/auth/local/local.controller.ts apps/api/test/auth-remember.e2e.spec.ts
git commit -m "feat(auth): 本地登录接收 remember 并据此下发 cookie"
```

---

## Task 3: refresh 延续 tp_remember + logout 清理

**Files:**
- Modify: `apps/api/src/auth/controllers/auth.controller.ts`(import `REMEMBER_COOKIE`;`refresh_` 读 cookie 并传 `remember`)
- Test: `apps/api/test/auth-remember.e2e.spec.ts`(追加用例)

- [ ] **Step 1: 追加失败测试**

在 `apps/api/test/auth-remember.e2e.spec.ts` 的 `describe` 内追加:

```ts
  it('refresh continues session semantics when tp_remember=0', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: false })
      .expect(200);
    const cookies = (login.headers['set-cookie'] as unknown as string[]).join('; ');
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    const arr = res.headers['set-cookie'] as unknown as string[];
    const refresh = arr.find((x) => x.startsWith('tp_refresh='))!;
    expect(refresh).not.toMatch(/Max-Age=/i);
    expect(refresh).not.toMatch(/Expires=/i);
  });

  it('refresh continues persistent semantics when tp_remember=1', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: true })
      .expect(200);
    const cookies = (login.headers['set-cookie'] as unknown as string[]).join('; ');
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    const refresh = (res.headers['set-cookie'] as unknown as string[]).find((x) =>
      x.startsWith('tp_refresh='),
    )!;
    expect(refresh).toMatch(/Max-Age=2592000/i);
  });

  it('logout clears tp_remember', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: true })
      .expect(200);
    const cookies = (login.headers['set-cookie'] as unknown as string[]).join('; ');
    const csrf = login.body.csrf as string;
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cleared).toMatch(/tp_remember=;/);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- auth-remember"`
Expected: FAIL —— "refresh continues session semantics" 失败(当前 refresh 恒下发持久 cookie)。`logout clears tp_remember` 此时应已通过(Task 1 已让 `clearAuthCookies` 清理),但作为回归保留。

- [ ] **Step 3: 实现 —— refresh 读 tp_remember 延续**

In `apps/api/src/auth/controllers/auth.controller.ts`,在已有 helper import 中加入 `REMEMBER_COOKIE`(当前从 `../jwt/jwt-cookie.helper.js` 已导入 `REFRESH_COOKIE, clearAuthCookies, setAuthCookies, type CookieEnv`):

```ts
import {
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type CookieEnv,
} from '../jwt/jwt-cookie.helper.js';
```

在 `refresh_` 方法中,把末尾的 `setAuthCookies(...)` 调用(当前 `auth.controller.ts:103`)替换为先读 cookie 再传 `remember`:

```ts
    // 续签时延续登录时的 remember 选择:tp_remember='0' → session;'1' 或缺失 → 持久(兼容存量会话)
    const remember = cookies[REMEMBER_COOKIE] !== '0';
    setAuthCookies(res, this.cookieEnv, { access: newAccess, refresh: newRefresh }, { remember });
```

(`cookies` 变量在方法开头已存在:`const cookies = (req as ...).cookies ?? {};`)

- [ ] **Step 4: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- auth-remember"`
Expected: PASS(全部 6 个用例)。

- [ ] **Step 5: 回归既有鉴权测试**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- auth-refresh auth-local local-login-roles"`
Expected: PASS(既有 Set-Cookie 断言只检查 `tp_access=`/`tp_refresh=` 存在,不受影响)。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/auth/controllers/auth.controller.ts apps/api/test/auth-remember.e2e.spec.ts
git commit -m "feat(auth): refresh 延续 tp_remember + logout 清理"
```

---

## Task 4: 前端登录页发送 remember 开关

**Files:**
- Modify: `apps/web/src/views/LoginView.vue:38-44`(`submitLocal` 请求体)

- [ ] **Step 1: 实现 —— body 加 remember**

In `apps/web/src/views/LoginView.vue` 的 `submitLocal`,把 `apiFetch` 调用的 body 改为带 `remember`:

```ts
    const result = await apiFetch<{ ok: true; csrf: string; mustChangePassword: boolean }>(
      '/auth/local/login',
      {
        method: 'POST',
        body: JSON.stringify({
          username: username.value,
          password: password.value,
          remember: remember.value,
        }),
      },
    );
```

(`remember` ref 已存在于 `LoginView.vue:17`,模板复选框已 `v-model="remember"`,无需改模板。)

- [ ] **Step 2: typecheck**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck"`
Expected: 无错误。

- [ ] **Step 3: 手测**

打开登录页 → 取消勾选"保持登录 30 天" → 用测试账号登录 → 浏览器 DevTools › Application › Cookies:`tp_access`/`tp_refresh`/`tp_remember` 的 Expires 列显示 "Session"。勾选后重登 → 显示具体过期时间(约 30 天后)。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/LoginView.vue
git commit -m "feat(web): 登录页发送 remember 开关"
```

---

## Task 5: GET /stats/overview 公开聚合端点

**Files:**
- Create: `apps/api/src/stats/stats.service.ts`、`apps/api/src/stats/stats.controller.ts`、`apps/api/src/stats/stats.module.ts`
- Modify: `apps/api/src/app.module.ts`(import + 注册 `StatsModule`)
- Test: `apps/api/test/stats-overview.e2e.spec.ts`(Create)

- [ ] **Step 1: 写失败测试**

Create `apps/api/test/stats-overview.e2e.spec.ts`:

```ts
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
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
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
    // 3 个 done(耗时 1000/2000/3000ms)、1 个 failed、1 个 pending —— 全在近 30 天内
    await prisma.renderJob.createMany({
      data: [
        { templateId, data: {}, formats: ['pdf'], status: 'done',
          startedAt: new Date(now - 10000), completedAt: new Date(now - 9000) },
        { templateId, data: {}, formats: ['pdf'], status: 'done',
          startedAt: new Date(now - 10000), completedAt: new Date(now - 8000) },
        { templateId, data: {}, formats: ['pdf'], status: 'done',
          startedAt: new Date(now - 10000), completedAt: new Date(now - 7000) },
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
    const svc = new StatsService(prisma as never); // 全新实例 → 缓存为空 → 实算
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- stats-overview"`
Expected: FAIL —— `../src/stats/stats.service.js` 不存在,编译失败。

- [ ] **Step 3: 实现 service**

Create `apps/api/src/stats/stats.service.ts`:

```ts
// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface StatsOverview {
  windowDays: number;
  monthlyRenders: number; // 近30天全部 render_jobs(任意 status)
  p50LatencyMs: number | null; // 近30天 done 任务渲染耗时中位数;无样本 → null
  successRate: number | null; // done/(done+failed);分母0 → null;取值 0..1
}

@Injectable()
export class StatsService {
  private static readonly WINDOW_DAYS = 30;
  private static readonly TTL_MS = 60_000;
  private cache: { data: StatsOverview; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<StatsOverview> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < StatsService.TTL_MS) return this.cache.data;
    const since = new Date(now - StatsService.WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const data = await this.computeOverview(since);
    this.cache = { data, at: now };
    return data;
  }

  // since 作为窗口下界(可注入,便于测试 null 路径);windowDays 契约固定 30。
  async computeOverview(since: Date): Promise<StatsOverview> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        monthly_renders: bigint;
        done_count: bigint;
        failed_count: bigint;
        p50_ms: number | null;
      }>
    >`
      SELECT
        count(*)::bigint AS monthly_renders,
        count(*) FILTER (WHERE status = 'done')::bigint AS done_count,
        count(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
        ) FILTER (
          WHERE status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL
        ) AS p50_ms
      FROM render_jobs
      WHERE created_at >= ${since}
    `;
    const r = rows[0];
    const done = Number(r?.done_count ?? 0n);
    const failed = Number(r?.failed_count ?? 0n);
    const denom = done + failed;
    return {
      windowDays: StatsService.WINDOW_DAYS,
      monthlyRenders: Number(r?.monthly_renders ?? 0n),
      p50LatencyMs: r?.p50_ms == null ? null : Math.round(Number(r.p50_ms)),
      successRate: denom === 0 ? null : done / denom,
    };
  }
}
```

- [ ] **Step 4: 实现 controller**

Create `apps/api/src/stats/stats.controller.ts`:

```ts
// eslint-disable-next-line import/no-unresolved
import { Controller, Get } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';

// eslint-disable-next-line import/no-unresolved
import { StatsService, type StatsOverview } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // @Public:登录页未登录即拉取,展示公开聚合值(集团内网,聚合量级敏感度低)。
  @Public()
  @Get('overview')
  async overview(): Promise<StatsOverview> {
    return this.stats.getOverview();
  }
}
```

- [ ] **Step 5: 实现 module**

Create `apps/api/src/stats/stats.module.ts`(PrismaService 来自 `@Global` 的 PrismaModule,无需 imports):

```ts
// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { StatsController } from './stats.controller.js';
// eslint-disable-next-line import/no-unresolved
import { StatsService } from './stats.service.js';

@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
```

- [ ] **Step 6: 注册到 AppModule**

In `apps/api/src/app.module.ts`,在 import 区(其它模块 import 之后,如 `UsersModule` 那行后)加:

```ts
// eslint-disable-next-line import/no-unresolved
import { StatsModule } from './stats/stats.module.js';
```

并在 `imports` 数组的 `UsersModule,` 之后加 `StatsModule,`。

- [ ] **Step 7: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- stats-overview"`
Expected: PASS(3 个用例)。

- [ ] **Step 8: typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck && pnpm run lint"`
Expected: 无错误、零告警。

- [ ] **Step 9: 提交**

```bash
git add apps/api/src/stats/ apps/api/src/app.module.ts apps/api/test/stats-overview.e2e.spec.ts
git commit -m "feat(stats): GET /stats/overview 公开聚合端点（近30天渲染量/P50/成功率）"
```

---

## Task 6: 登录页三指标接真实接口

**Files:**
- Modify: `apps/web/src/views/LoginView.vue`(script:`onMounted` 拉取 + 格式化 computed;template:三个 stat 块)

- [ ] **Step 1: 实现 —— script 拉取 + 格式化**

In `apps/web/src/views/LoginView.vue`,把顶部 vue import 从 `import { ref } from 'vue';` 改为:

```ts
import { computed, onMounted, ref } from 'vue';
```

在 `const lang = ref<'cn' | 'en'>('cn');` 之后,加入 stats 拉取与格式化:

```ts
interface StatsOverview {
  windowDays: number;
  monthlyRenders: number;
  p50LatencyMs: number | null;
  successRate: number | null;
}

const stats = ref<StatsOverview | null>(null);

onMounted(async () => {
  try {
    stats.value = await apiFetch<StatsOverview>('/stats/overview');
  } catch {
    // 静默失败:保持 stats=null → 三指标显示 —,绝不回退硬编码旧数字
    stats.value = null;
  }
});

function fmtRenders(n: number | null | undefined): { value: string; unit: string } {
  if (n == null) return { value: '—', unit: '' };
  if (n >= 1000) return { value: (n / 1000).toFixed(n >= 10000 ? 0 : 1), unit: 'k' };
  return { value: String(n), unit: '' };
}

const rendersStat = computed(() => fmtRenders(stats.value?.monthlyRenders));
const p50Stat = computed(() => {
  const ms = stats.value?.p50LatencyMs;
  return ms == null ? { value: '—', unit: '' } : { value: (ms / 1000).toFixed(1), unit: 's' };
});
const successStat = computed(() => {
  const r = stats.value?.successRate;
  return r == null ? { value: '—', unit: '' } : { value: (r * 100).toFixed(2), unit: '%' };
});
```

- [ ] **Step 2: 实现 —— template 三个 stat 块**

把 `apps/web/src/views/LoginView.vue` 中 `<div class="tp-l-stats">` 内的三个 `.tp-l-stat`(当前 `:112-122` 硬编码 `128`/`1.2`/`99.97`)替换为:

```html
      <div class="tp-l-stats">
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ rendersStat.value }}<span v-if="rendersStat.unit" class="tp-l-unit">{{ rendersStat.unit }}</span>
          </div>
          <div class="tp-l-lbl">月渲染量 <span class="tp-l-lbl-en">RENDERS / MO</span></div>
        </div>
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ p50Stat.value }}<span v-if="p50Stat.unit" class="tp-l-unit">{{ p50Stat.unit }}</span>
          </div>
          <div class="tp-l-lbl">P50 延迟 <span class="tp-l-lbl-en">P50 LATENCY</span></div>
        </div>
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ successStat.value }}<span v-if="successStat.unit" class="tp-l-unit">{{ successStat.unit }}</span>
          </div>
          <div class="tp-l-lbl">渲染成功率 <span class="tp-l-lbl-en">SUCCESS RATE</span></div>
        </div>
      </div>
```

- [ ] **Step 3: typecheck**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck"`
Expected: 无错误。

- [ ] **Step 4: 手测**

1. 正常:打开登录页 → 三个数字为真实值(开发库若有渲染任务则非零;成功率两位小数、P50 带 s)。`curl http://localhost:3000/api/stats/overview`(或实际 API 端口)应返回 JSON。
2. 无数据:若开发库近 30 天无 render_jobs → 月渲染量显示真实值(可能 0),P50/成功率显示 `—`。
3. 接口失败:临时停 API 容器或断网 → 三指标全部显示 `—`,页面不报错、不卡。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/views/LoginView.vue
git commit -m "feat(web): 登录页三指标接真实接口，失败/空显示 —"
```

---

## Task 7: 文档同步

**Files:**
- Modify: `docs/PROGRESS.md`(第 3 节"近期变更"追加;"最近更新"日期改 2026-05-26)
- Modify: `AGENTS.md`(第 2 节目录结构补 `apps/api/src/stats/`)

- [ ] **Step 1: 更新 PROGRESS.md**

读 `docs/PROGRESS.md`,在"近期变更"列表顶部追加一条(贴合现有条目风格):

```markdown
- **2026-05-26**:登录页"假控件/假数据"转真实 —— ①"保持登录 30 天"接通:cookie helper 实现 remember 语义(不勾=session cookie、勾=30d 持久 + `tp_remember`),`/auth/refresh` 读 `tp_remember` 延续、`/auth/logout` 清理;②新增 `@Public` 端点 `GET /stats/overview`(近 30 天全部 render_jobs 计数 / done 任务 P50 渲染耗时 / 成功率,60s 内存缓存),登录页三指标改为真实拉取,失败或无数据显示 `—`。
```

并把文件顶部"最近更新"日期同步为 `2026-05-26`(若存在该字段)。

- [ ] **Step 2: 更新"已交付能力"(若该节存在对应清单)**

在 `docs/PROGRESS.md` 的"已交付能力"列表补一条:

```markdown
- 登录会话时长可由"保持登录"开关控制(session / 30 天);登录页运营指标来自真实 `GET /stats/overview`。
```

- [ ] **Step 3: 更新 AGENTS.md 目录结构**

In `AGENTS.md` 第 2 节目录结构,在 `apps/api/src/users/` 同级补一行:

```
│   │   ├── stats/            # 公开运营指标聚合(GET /stats/overview,近30天渲染量/P50/成功率)
```

(缩进/前缀符号对齐相邻条目的实际写法。)

- [ ] **Step 4: 提交**

```bash
git add docs/PROGRESS.md AGENTS.md
git commit -m "docs: 同步登录页真实数据特性"
```

---

## Final Verification(全部 task 完成后)

- [ ] 全量 API 测试:`docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test"` → 全绿(含既有 24 套 + 本次新增 3 个 spec)。
- [ ] API + web typecheck:两个容器 `pnpm run typecheck` → 0。
- [ ] API + web lint:两个容器 `pnpm run lint` → 零告警。
- [ ] 端到端手测:登录页正常态(真实数字)/ 无数据态(`—`)/ 接口失败态(`—`)、勾选与不勾"保持登录"的 cookie 过期差异。

---

## Self-Review(写计划后自检结果)

**Spec 覆盖:**
- §2.3 #1 cookie helper remember → Task 1 ✅
- §2.3 #1(前端 body) → Task 4 ✅;§2.3 #2(local schema/调用) → Task 2 ✅;§2.3 #2(refresh 延续) → Task 3 ✅;§2.2 logout 清理 → Task 1(helper)+ Task 3(测试)✅
- §2.4 测试(session/persistent/refresh 延续/logout 清理) → Task 1 单元 + Task 2/3 e2e ✅
- §3.2 模块 + §3.3 契约 + §3.4 口径(monthlyRenders 全部、p50 仅 done、successRate done/(done+failed)、null)+ §3.5 60s 缓存 → Task 5 ✅
- §3.6 前端(失败/null→`—`、移除硬编码、k 格式化、单位拆分复用样式) → Task 6 ✅
- §3.7 测试(交叉校验、空窗口、@Public) → Task 5 ✅
- §4 文档(PROGRESS/AGENTS;.env 无新增,无需改) → Task 7 ✅

**占位符扫描:** 无 TBD/TODO;每个代码步骤含完整代码。

**类型一致性:** `StatsOverview` 字段(windowDays/monthlyRenders/p50LatencyMs/successRate)在 service、controller、前端 interface、测试断言中一致;`setAuthCookies` 第四参 `{ remember?: boolean }` 在 helper 定义、local/auth controller 调用一致;`REMEMBER_COOKIE` 常量名跨 helper/auth.controller/测试一致。
