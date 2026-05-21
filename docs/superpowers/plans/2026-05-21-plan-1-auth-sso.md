# Plan 1 — Auth & SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the platform usable end-to-end as a logged-in user. Web users authenticate via 飞书 (Lark) SSO; an emergency local admin account is available when Lark is unavailable. All authenticated state lives in an httpOnly cookie JWT with CSRF double-submit protection. The Lark webview entry from inside Feishu opens the same app with seamless SSO.

**Architecture:** OAuth 2.0 authorization-code flow against Feishu's authen API. Backend issues its own JWT (sub = local users.id) after Lark redirect-back; refresh token stored hashed in DB. Stateless guards check JWT cookie + CSRF token header (token embedded as JWT claim, no server-side session store). Emergency admin uses bcrypt password + same JWT issuance. Frontend has a Pinia auth store hydrated from `/auth/me` on app load; a router guard pushes to `/login` on 401.

**Tech Stack:** `@nestjs/jwt`, `@larksuiteoapi/node-sdk`, `bcryptjs`, `cookie-parser`, `helmet`. Frontend: Pinia + Vue Router navigation guards + fetch wrapper that auto-attaches CSRF header.

**Spec reference:** `docs/superpowers/specs/2026-05-21-template-printing-platform-design.md` — §§ 4 (LarkSSO, LocalEmergencyAdmin, LarkWorkspaceEntry), 7.1 (routes), 7.2 (auth contract), 7.2.x (Lark OAuth flow), 7.2.y (webview adapter), 8.5 (users + refresh_tokens), 13.3 (auth decisions).

**Builds on:** Plan 0 (commit `c25cc59` on master). Assumes `apps/api` scaffold + env validation + Pino + Prisma + healthz are in place.

**Out of scope (deferred to later plans):**
- `apk_xxx` API Key system, scopes, and CRUD — Plan 5 (Print API), since the only consumers of API Keys are external print callers.
- `lark_credentials` table + AES-256-GCM encryption — Plan 5 (also consumed only by print → Lark write-back).
- Password change UI for `mustChangePassword=true` users — Plan 3 (when the rest of admin UI lands).

---

## File Structure (created/modified by this plan)

```
apps/api/
├── prisma/
│   ├── schema.prisma                    # MODIFY: full User + add unique constraints + indexes
│   └── migrations/
│       └── <ts>_init_auth/migration.sql # CREATE (via prisma migrate dev)
├── src/
│   ├── auth/                            # CREATE — entire auth subtree
│   │   ├── auth.module.ts
│   │   ├── lark/
│   │   │   ├── lark.module.ts
│   │   │   ├── lark.service.ts          # @larksuiteoapi/node-sdk wrapper
│   │   │   └── lark.controller.ts       # /auth/lark/login + /callback
│   │   ├── local/
│   │   │   └── local.controller.ts      # /auth/local/login
│   │   ├── jwt/
│   │   │   ├── jwt.service.ts           # sign/verify wrappers + CSRF token
│   │   │   ├── refresh-token.service.ts # hash + create + revoke
│   │   │   └── jwt-cookie.helper.ts     # cookie set/clear, options shared
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── csrf.guard.ts
│   │   │   └── roles.guard.ts           # + @Roles() decorator
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts # @CurrentUser()
│   │   │   └── public.decorator.ts       # @Public()
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts       # /auth/logout, /auth/refresh
│   │   │   └── me.controller.ts         # /users/me
│   │   └── bootstrap/
│   │       └── emergency-admin.bootstrap.ts # ensure emergency_admin exists
│   ├── common/
│   │   ├── env.ts                       # MODIFY: add LARK_SSO_REGION, INITIAL_ADMIN_LOCAL_PASSWORD required if no admin
│   │   └── security-headers.middleware.ts # CREATE: CSP + cookie defaults
│   └── app.module.ts                    # MODIFY: import AuthModule, register cookie-parser, helmet
├── test/
│   ├── auth-lark.e2e.spec.ts            # CREATE
│   ├── auth-local.e2e.spec.ts           # CREATE
│   ├── auth-refresh.e2e.spec.ts         # CREATE
│   └── auth-guards.spec.ts              # CREATE (unit tests for guards)
└── package.json                          # MODIFY: + @nestjs/jwt, @larksuiteoapi/node-sdk, bcryptjs, cookie-parser, helmet, nock

apps/web/
├── src/
│   ├── stores/
│   │   └── auth.ts                       # CREATE — Pinia auth store
│   ├── lib/
│   │   ├── api.ts                        # CREATE — fetch wrapper with CSRF
│   │   └── auth-routes.ts                # CREATE — constants
│   ├── views/
│   │   ├── LoginView.vue                 # CREATE
│   │   ├── LoginCallbackView.vue         # CREATE (intermediate page)
│   │   └── HomeView.vue                  # MODIFY: show current user + logout button
│   ├── components/
│   │   └── AppHeader.vue                 # CREATE
│   ├── router/
│   │   └── index.ts                      # MODIFY: add /login + global guard
│   └── App.vue                           # MODIFY: hydrate store + AppHeader
└── package.json                          # MODIFY: no new deps (uses fetch + native)

packages/schema/
└── src/index.ts                          # MODIFY: + AuthMeResponseSchema, LoginRequestSchema
```

---

## Task Map (21 tasks)

| # | Task | Affects |
|---|---|---|
| 1 | DB: full User + RefreshToken schema + initial migration | apps/api/prisma |
| 2 | env.ts updates (Lark region default, admin password requirement) | apps/api/src/common/env.ts |
| 3 | Install auth deps | apps/api/package.json |
| 4 | JwtService wrapper (sign + verify, CSRF claim) | apps/api/src/auth/jwt |
| 5 | RefreshTokenService (DB-backed hashed tokens) | apps/api/src/auth/jwt |
| 6 | JwtCookieHelper (set/clear cookies, security defaults) | apps/api/src/auth/jwt |
| 7 | JwtAuthGuard + @CurrentUser decorator + @Public decorator | apps/api/src/auth/guards |
| 8 | CsrfGuard | apps/api/src/auth/guards |
| 9 | RolesGuard + @Roles decorator | apps/api/src/auth/guards |
| 10 | LarkService (SDK wrapper: token exchange + user_info) | apps/api/src/auth/lark |
| 11 | LarkController: GET /auth/lark/login (state cookie + redirect) | apps/api/src/auth/lark |
| 12 | LarkController: GET /auth/lark/callback (full upsert + sign JWT) | apps/api/src/auth/lark |
| 13 | LocalController: POST /auth/local/login (bcrypt) | apps/api/src/auth/local |
| 14 | AuthController: POST /auth/logout + /auth/refresh | apps/api/src/auth/controllers |
| 15 | MeController: GET /users/me | apps/api/src/auth/controllers |
| 16 | EmergencyAdminBootstrap (startup ensure + first-login forced change) | apps/api/src/auth/bootstrap |
| 17 | AuthModule wiring + register in AppModule + cookie-parser + helmet | apps/api |
| 18 | SecurityHeadersMiddleware (CSP frame-ancestors for Lark webview) | apps/api/src/common |
| 19 | Frontend: api.ts fetch wrapper + AuthStore (Pinia) | apps/web/src/lib + stores |
| 20 | Frontend: LoginView + LoginCallbackView + AppHeader + router guard | apps/web/src/views + components + router |
| 21 | E2E: Lark OAuth flow + local login + refresh flow + guard unit tests | apps/api/test |

---

## Task 1: Full User + RefreshToken schema + initial migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_init_auth/migration.sql` (via prisma migrate dev)

- [ ] **Step 1: Replace `apps/api/prisma/schema.prisma`**

```prisma
// Auth-domain schema. Business tables (templates, print_jobs, ...) added in Plans 3+.
// Spec § 8.5

generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                  String    @id @default(uuid())

  // Lark identity — null for emergency_admin only
  larkOpenId          String?   @unique @map("lark_open_id")
  larkUnionId         String?   @map("lark_union_id")
  larkUserId          String?   @map("lark_user_id")

  name                String?
  email               String?
  avatarUrl           String?   @map("avatar_url")

  // 'admin' | 'user' | 'emergency_admin'
  role                String    @default("user")

  // Local emergency credentials — null for Lark users
  localUsername       String?   @unique @map("local_username")
  localPasswordHash   String?   @map("local_password_hash")
  mustChangePassword  Boolean   @default(false) @map("must_change_password")

  lastLoginAt         DateTime? @map("last_login_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt        @map("updated_at")

  refreshTokens       RefreshToken[]

  @@index([role])
  @@map("users")
}

model RefreshToken {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  tokenHash   String    @unique @map("token_hash")
  expiresAt   DateTime  @map("expires_at")
  revokedAt   DateTime? @map("revoked_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}
```

- [ ] **Step 2: Start postgres locally and apply migration**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d postgres
# wait ~5s for postgres healthy
docker compose -f docker-compose.dev.yml ps
```
Expected: postgres `healthy`.

Then:
```bash
cd apps/api
pnpm exec prisma migrate dev --name init_auth
cd ../..
```
Expected: creates `apps/api/prisma/migrations/<ts>_init_auth/migration.sql` and applies. Output mentions "Applied the following migration(s)". Prisma Client regenerated.

- [ ] **Step 3: Verify migration content**

Read `apps/api/prisma/migrations/<latest>/migration.sql` — confirm it contains `CREATE TABLE users`, `CREATE TABLE refresh_tokens`, `CREATE UNIQUE INDEX ... lark_open_id`, `CREATE UNIQUE INDEX ... local_username`, and `CREATE INDEX ... role`. If anything is missing (e.g. older schema artifact present), drop the dev DB and re-run:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d postgres
pnpm --filter @template-printing/api db:migrate:dev -- --name init_auth
```

- [ ] **Step 4: Commit**

```bash
git checkout -b feature/plan-1-auth-sso
git add apps/api/prisma/
git commit -m "feat(api): full User and RefreshToken schema + initial auth migration"
```

---

## Task 2: env.ts updates

**Files:**
- Modify: `apps/api/src/common/env.ts`
- Modify: `apps/api/test/env.spec.ts` (verify still passes)

- [ ] **Step 1: Read current `apps/api/src/common/env.ts`**

(Already exists from Plan 0 T7. Will modify in place.)

- [ ] **Step 2: Replace `apps/api/src/common/env.ts`** with extended version (only changes from Plan 0 T7: add 4 fields and one comment)

```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(86400), // 24h
  REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30d
  FILE_SIG_SECRET: z.string().min(32, 'FILE_SIG_SECRET must be at least 32 chars'),
  MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be 64 hex chars (32 bytes)'),

  LARK_SSO_APP_ID: z.string().min(1),
  LARK_SSO_APP_SECRET: z.string().min(1),
  LARK_SSO_REDIRECT_URI: z.string().url(),
  LARK_API_BASE: z.string().url().default('https://open.feishu.cn'),
  LARK_PASSPORT_BASE: z.string().url().default('https://passport.feishu.cn'),
  LARK_ACCOUNTS_BASE: z.string().url().default('https://accounts.feishu.cn'),
  INITIAL_ADMIN_LARK_USER_IDS: z.string().default(''),

  INITIAL_ADMIN_LOCAL_USERNAME: z.string().default('emergency_admin'),
  INITIAL_ADMIN_LOCAL_PASSWORD: z.string().min(8).optional(),

  // Cookie domain for SSO — '' means use request host (default for local dev)
  COOKIE_DOMAIN: z.string().default(''),

  RENDER_BROWSERS: z.coerce.number().int().positive().default(4),
  RENDER_PAGES_PER_BROWSER: z.coerce.number().int().positive().default(2),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${issues}`);
  }
  return parsed.data;
}
```

- [ ] **Step 3: Run existing env tests**

Run: `pnpm --filter @template-printing/api test test/env.spec.ts`
Expected: all 4 existing tests still pass. New fields all default, so no test changes needed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/common/env.ts
git commit -m "feat(api): env additions for JWT TTLs, Lark passport/accounts base, cookie domain"
```

---

## Task 3: Install auth deps

**Files:**
- Modify: `apps/api/package.json` (deps)
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm --filter @template-printing/api add \
  @nestjs/jwt@10.2.0 \
  @larksuiteoapi/node-sdk@1.40.0 \
  bcryptjs@2.4.3 \
  cookie-parser@1.4.6 \
  helmet@7.1.0
```

- [ ] **Step 2: Install dev deps**

```bash
pnpm --filter @template-printing/api add -D \
  @types/bcryptjs@2.4.6 \
  @types/cookie-parser@1.4.7 \
  nock@13.5.4
```

- [ ] **Step 3: Verify build still passes**

Run: `pnpm --filter @template-printing/api build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add auth deps (jwt, lark sdk, bcryptjs, cookie-parser, helmet, nock)"
```

---

## Task 4: JwtService wrapper

**Files:**
- Create: `apps/api/src/auth/jwt/jwt.service.ts`
- Create: `apps/api/test/jwt-service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/test/jwt-service.spec.ts`:

```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';

import { JwtAuthService } from '../src/auth/jwt/jwt.service.js';

describe('JwtAuthService', () => {
  let svc: JwtAuthService;

  beforeAll(() => {
    svc = new JwtAuthService('a'.repeat(32), 3600);
  });

  it('signs a token containing sub, role, csrf', () => {
    const { token, csrf } = svc.sign({ sub: 'user-1', role: 'admin' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
    expect(typeof csrf).toBe('string');
    expect(csrf.length).toBeGreaterThanOrEqual(32);
  });

  it('verifies a valid token and returns claims', () => {
    const { token, csrf } = svc.sign({ sub: 'user-2', role: 'user' });
    const claims = svc.verify(token);
    expect(claims.sub).toBe('user-2');
    expect(claims.role).toBe('user');
    expect(claims.csrf).toBe(csrf);
  });

  it('rejects a tampered token', () => {
    const { token } = svc.sign({ sub: 'user-3', role: 'user' });
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(() => svc.verify(tampered)).toThrow();
  });

  it('rejects an expired token', async () => {
    const shortLived = new JwtAuthService('a'.repeat(32), 1);
    const { token } = shortLived.sign({ sub: 'u', role: 'user' });
    await new Promise((r) => setTimeout(r, 1100));
    expect(() => shortLived.verify(token)).toThrow();
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @template-printing/api test test/jwt-service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/auth/jwt/jwt.service.ts`**

```typescript
import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService as NestJwt } from '@nestjs/jwt';

export interface JwtClaims {
  sub: string;     // users.id
  role: 'admin' | 'user' | 'emergency_admin';
  csrf: string;    // anti-CSRF token (32 bytes hex)
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAuthService {
  private readonly nest: NestJwt;
  private readonly ttlSeconds: number;

  constructor(secret: string, ttlSeconds: number) {
    this.nest = new NestJwt({ secret, signOptions: { expiresIn: ttlSeconds } });
    this.ttlSeconds = ttlSeconds;
  }

  sign(payload: { sub: string; role: JwtClaims['role'] }): { token: string; csrf: string } {
    const csrf = randomBytes(32).toString('hex');
    const token = this.nest.sign({ ...payload, csrf });
    return { token, csrf };
  }

  verify(token: string): JwtClaims {
    return this.nest.verify<JwtClaims>(token);
  }

  get ttl(): number {
    return this.ttlSeconds;
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @template-printing/api test test/jwt-service.spec.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/jwt/jwt.service.ts apps/api/test/jwt-service.spec.ts
git commit -m "feat(api): JwtAuthService — sign/verify with embedded CSRF token"
```

---

## Task 5: RefreshTokenService

**Files:**
- Create: `apps/api/src/auth/jwt/refresh-token.service.ts`
- Create: `apps/api/test/refresh-token-service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/test/refresh-token-service.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

import { RefreshTokenService } from '../src/auth/jwt/refresh-token.service.js';

describe('RefreshTokenService', () => {
  const prisma = new PrismaClient();
  const svc = new RefreshTokenService(prisma, 60); // 60s TTL for test
  let userId: string;

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    const u = await prisma.user.create({
      data: { role: 'user', name: 'Test', larkOpenId: 'ou_test_' + Date.now() },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  it('creates a token, returns plaintext + record id', async () => {
    const { plaintext, id } = await svc.create(userId);
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
    const row = await prisma.refreshToken.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).not.toBe(plaintext); // stored hashed
  });

  it('verify accepts valid plaintext and returns userId', async () => {
    const { plaintext } = await svc.create(userId);
    const result = await svc.verify(plaintext);
    expect(result?.userId).toBe(userId);
  });

  it('verify rejects unknown plaintext', async () => {
    const result = await svc.verify('0'.repeat(64));
    expect(result).toBeNull();
  });

  it('verify rejects revoked tokens', async () => {
    const { plaintext, id } = await svc.create(userId);
    await svc.revoke(id);
    const result = await svc.verify(plaintext);
    expect(result).toBeNull();
  });

  it('verify rejects expired tokens', async () => {
    const shortLived = new RefreshTokenService(prisma, 1);
    const { plaintext } = await shortLived.create(userId);
    await new Promise((r) => setTimeout(r, 1100));
    const result = await shortLived.verify(plaintext);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `pnpm --filter @template-printing/api test test/refresh-token-service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/auth/jwt/refresh-token.service.ts`**

```typescript
import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlSeconds: number,
  ) {}

  async create(userId: string): Promise<{ plaintext: string; id: string }> {
    const plaintext = randomBytes(32).toString('hex'); // 64 hex chars
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const row = await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return { plaintext, id: row.id };
  }

  async verify(plaintext: string): Promise<{ userId: string; id: string } | null> {
    if (!/^[0-9a-f]{64}$/.test(plaintext)) return null;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return { userId: row.userId, id: row.id };
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Requires postgres up. If not running:
```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

Then:
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/template_printing pnpm --filter @template-printing/api test test/refresh-token-service.spec.ts
```
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/jwt/refresh-token.service.ts apps/api/test/refresh-token-service.spec.ts
git commit -m "feat(api): RefreshTokenService — hashed token storage + verify + revoke"
```

---

## Task 6: JwtCookieHelper

**Files:**
- Create: `apps/api/src/auth/jwt/jwt-cookie.helper.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/jwt/jwt-cookie.helper.ts`**

```typescript
import type { Response, CookieOptions } from 'express';

export const ACCESS_COOKIE = 'tp_access';
export const REFRESH_COOKIE = 'tp_refresh';

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
): void {
  res.cookie(ACCESS_COOKIE, tokens.access, {
    ...baseOptions(env),
    maxAge: env.accessTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...baseOptions(env),
    maxAge: env.refreshTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res: Response, env: CookieEnv): void {
  res.clearCookie(ACCESS_COOKIE, baseOptions(env));
  res.clearCookie(REFRESH_COOKIE, baseOptions(env));
}
```

- [ ] **Step 2: Smoke check via typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/jwt/jwt-cookie.helper.ts
git commit -m "feat(api): cookie helper for access/refresh tokens with SameSite=None in prod"
```

---

## Task 7: JwtAuthGuard + @CurrentUser + @Public decorators

**Files:**
- Create: `apps/api/src/auth/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/auth/decorators/current-user.decorator.ts`
- Create: `apps/api/src/auth/decorators/public.decorator.ts`

- [ ] **Step 1: Create `apps/api/src/auth/decorators/public.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 2: Create `apps/api/src/auth/decorators/current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { JwtClaims } from '../jwt/jwt.service.js';

export interface AuthenticatedRequest extends Request {
  user?: JwtClaims;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);
```

- [ ] **Step 3: Create `apps/api/src/auth/guards/jwt-auth.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';
import { JwtAuthService } from '../jwt/jwt.service.js';
import { ACCESS_COOKIE } from '../jwt/jwt-cookie.helper.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtAuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const token = cookies[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('No access token');

    try {
      req.user = this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
```

- [ ] **Step 4: Write a quick unit test**

Create `apps/api/test/jwt-auth-guard.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
import { JwtAuthService } from '../src/auth/jwt/jwt.service.js';
import { ACCESS_COOKIE } from '../src/auth/jwt/jwt-cookie.helper.js';

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const jwt = new JwtAuthService('a'.repeat(32), 60);
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard(reflector, jwt);
  });

  function mockCtx(cookies: Record<string, string> = {}): ExecutionContext {
    const req: Record<string, unknown> = { cookies };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows public endpoints without a cookie', () => {
    const saveGet = reflector.getAllAndOverride;
    reflector.getAllAndOverride = (() => true) as typeof saveGet;
    expect(guard.canActivate(mockCtx())).toBe(true);
    reflector.getAllAndOverride = saveGet;
  });

  it('rejects when no access cookie', () => {
    expect(() => guard.canActivate(mockCtx())).toThrow(UnauthorizedException);
  });

  it('attaches user when cookie is valid', () => {
    const { token } = jwt.sign({ sub: 'u-1', role: 'admin' });
    const ctx = mockCtx({ [ACCESS_COOKIE]: token });
    expect(guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { sub: string } };
    expect(req.user?.sub).toBe('u-1');
  });

  it('rejects invalid token', () => {
    const ctx = mockCtx({ [ACCESS_COOKIE]: 'garbage' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @template-printing/api test test/jwt-auth-guard.spec.ts`
Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/guards/jwt-auth.guard.ts apps/api/src/auth/decorators/ apps/api/test/jwt-auth-guard.spec.ts
git commit -m "feat(api): JwtAuthGuard + @CurrentUser + @Public decorators"
```

---

## Task 8: CsrfGuard

**Files:**
- Create: `apps/api/src/auth/guards/csrf.guard.ts`
- Create: `apps/api/test/csrf-guard.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/test/csrf-guard.spec.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { CsrfGuard } from '../src/auth/guards/csrf.guard.js';

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  function mockCtx(method: string, headers: Record<string, string>, user?: { csrf: string }): ExecutionContext {
    const req: Record<string, unknown> = { method, headers, user };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it('allows GET without csrf header', () => {
    expect(guard.canActivate(mockCtx('GET', {}))).toBe(true);
  });

  it('allows HEAD/OPTIONS without csrf header', () => {
    expect(guard.canActivate(mockCtx('HEAD', {}))).toBe(true);
    expect(guard.canActivate(mockCtx('OPTIONS', {}))).toBe(true);
  });

  it('rejects POST without csrf header', () => {
    expect(() => guard.canActivate(mockCtx('POST', {}, { csrf: 'abc' }))).toThrow(ForbiddenException);
  });

  it('rejects POST with mismatched csrf', () => {
    expect(() =>
      guard.canActivate(mockCtx('POST', { 'x-csrf-token': 'wrong' }, { csrf: 'right' })),
    ).toThrow(ForbiddenException);
  });

  it('allows POST with matching csrf', () => {
    expect(
      guard.canActivate(mockCtx('POST', { 'x-csrf-token': 'token-123' }, { csrf: 'token-123' })),
    ).toBe(true);
  });

  it('rejects POST when no user attached (guard order error)', () => {
    expect(() => guard.canActivate(mockCtx('POST', { 'x-csrf-token': 'x' }))).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `pnpm --filter @template-printing/api test test/csrf-guard.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/api/src/auth/guards/csrf.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;

    const headerToken = (req.headers['x-csrf-token'] ??
      req.headers['X-CSRF-Token']) as string | undefined;
    const expected = req.user?.csrf;
    if (!expected || !headerToken || headerToken !== expected) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }
    return true;
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @template-printing/api test test/csrf-guard.spec.ts`
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/guards/csrf.guard.ts apps/api/test/csrf-guard.spec.ts
git commit -m "feat(api): CsrfGuard — header X-CSRF-Token must match JWT claim"
```

---

## Task 9: RolesGuard + @Roles decorator

**Files:**
- Create: `apps/api/src/auth/guards/roles.guard.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/guards/roles.guard.ts`**

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';
import type { JwtClaims } from '../jwt/jwt.service.js';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: JwtClaims['role'][]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<JwtClaims['role'][]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(`Requires role: ${required.join(', ')}`);
    }
    return true;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/guards/roles.guard.ts
git commit -m "feat(api): RolesGuard + @Roles decorator"
```

---

## Task 10: LarkService (SDK wrapper)

**Files:**
- Create: `apps/api/src/auth/lark/lark.service.ts`
- Create: `apps/api/test/lark-service.spec.ts`

- [ ] **Step 1: Write failing test (using nock for HTTP mocking)**

Create `apps/api/test/lark-service.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import nock from 'nock';

import { LarkService } from '../src/auth/lark/lark.service.js';

describe('LarkService', () => {
  const PASSPORT_BASE = 'https://passport.feishu.cn';
  const OPEN_BASE = 'https://open.feishu.cn';
  let svc: LarkService;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    svc = new LarkService({
      appId: 'cli_test',
      appSecret: 'secret_test',
      passportBase: PASSPORT_BASE,
      openBase: OPEN_BASE,
    });
  });

  it('buildAuthorizeUrl produces correct URL with state', () => {
    const url = svc.buildAuthorizeUrl({
      redirectUri: 'https://example.com/cb',
      state: 'abc',
    });
    expect(url).toContain('https://accounts.feishu.cn/open-apis/authen/v1/index');
    expect(url).toContain('app_id=cli_test');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcb');
    expect(url).toContain('state=abc');
  });

  it('exchangeCode trades code for user_access_token', async () => {
    nock(PASSPORT_BASE)
      .post('/suite/passport/oauth/token', (body) => {
        return body.grant_type === 'authorization_code' && body.code === 'code-123';
      })
      .reply(200, {
        access_token: 'u-at-xyz',
        token_type: 'Bearer',
        expires_in: 7200,
        refresh_token: 'u-rt-xyz',
        scope: 'contact:user.base:readonly',
      });

    const result = await svc.exchangeCode({ code: 'code-123', redirectUri: 'https://example.com/cb' });
    expect(result.access_token).toBe('u-at-xyz');
    expect(result.expires_in).toBe(7200);
  });

  it('fetchUserInfo returns parsed user fields', async () => {
    nock(OPEN_BASE)
      .get('/open-apis/authen/v1/user_info')
      .reply(200, {
        code: 0,
        msg: 'success',
        data: {
          open_id: 'ou_abc',
          union_id: 'on_abc',
          user_id: 'uid_abc',
          name: 'Test User',
          en_name: 'Test User',
          email: 'test@example.com',
          avatar_url: 'https://avatar.example.com/abc.jpg',
        },
      });

    const info = await svc.fetchUserInfo('u-at-xyz');
    expect(info.open_id).toBe('ou_abc');
    expect(info.union_id).toBe('on_abc');
    expect(info.name).toBe('Test User');
    expect(info.avatar_url).toBe('https://avatar.example.com/abc.jpg');
  });

  it('fetchUserInfo throws on non-zero code', async () => {
    nock(OPEN_BASE)
      .get('/open-apis/authen/v1/user_info')
      .reply(200, { code: 99991663, msg: 'invalid access token', data: null });

    await expect(svc.fetchUserInfo('bad-token')).rejects.toThrow(/invalid access token/);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `pnpm --filter @template-printing/api test test/lark-service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/api/src/auth/lark/lark.service.ts`**

We do not use the high-level `@larksuiteoapi/node-sdk` Client for the OAuth flow because the SDK's authen flow is geared toward server-side cron use (tenant_access_token), while user-side OAuth is a thin HTTP wrapper.

```typescript
import { Injectable } from '@nestjs/common';

export interface LarkServiceConfig {
  appId: string;
  appSecret: string;
  passportBase: string;  // e.g. https://passport.feishu.cn
  openBase: string;      // e.g. https://open.feishu.cn
  accountsBase?: string; // e.g. https://accounts.feishu.cn (defaults to lark)
}

export interface LarkTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface LarkUserInfo {
  open_id: string;
  union_id: string;
  user_id: string;
  name: string;
  en_name?: string;
  email?: string;
  mobile?: string;
  avatar_url: string;
  avatar_thumb?: string;
  avatar_middle?: string;
  avatar_big?: string;
}

@Injectable()
export class LarkService {
  private readonly accountsBase: string;

  constructor(private readonly cfg: LarkServiceConfig) {
    this.accountsBase = cfg.accountsBase ?? 'https://accounts.feishu.cn';
  }

  buildAuthorizeUrl(args: { redirectUri: string; state: string; scope?: string }): string {
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      redirect_uri: args.redirectUri,
      state: args.state,
    });
    if (args.scope) params.set('scope', args.scope);
    return `${this.accountsBase}/open-apis/authen/v1/index?${params.toString()}`;
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<LarkTokenResponse> {
    const res = await fetch(`${this.cfg.passportBase}/suite/passport/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.cfg.appId,
        client_secret: this.cfg.appSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lark token exchange failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as LarkTokenResponse;
    return json;
  }

  async fetchUserInfo(userAccessToken: string): Promise<LarkUserInfo> {
    const res = await fetch(`${this.cfg.openBase}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Lark user_info failed: ${res.status}`);
    }
    const body = (await res.json()) as { code: number; msg: string; data: LarkUserInfo };
    if (body.code !== 0) {
      throw new Error(`Lark user_info code=${body.code}: ${body.msg}`);
    }
    return body.data;
  }
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @template-printing/api test test/lark-service.spec.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/lark/lark.service.ts apps/api/test/lark-service.spec.ts
git commit -m "feat(api): LarkService — authorize URL builder + code exchange + user_info"
```

---

## Task 11: LarkController — GET /auth/lark/login

**Files:**
- Create: `apps/api/src/auth/lark/lark.controller.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/lark/lark.controller.ts`** (only the /login handler — callback added in Task 12)

```typescript
import { randomBytes } from 'node:crypto';

import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../decorators/public.decorator.js';
import { LarkService } from './lark.service.js';

export const STATE_COOKIE = 'tp_lark_state';
export const CONTINUE_COOKIE = 'tp_lark_continue';
const STATE_TTL_SECONDS = 300; // 5 minutes

@Controller('auth/lark')
export class LarkController {
  constructor(
    private readonly lark: LarkService,
    @Inject('LARK_CONFIG')
    private readonly cfg: { redirectUri: string; nodeEnv: string },
  ) {}

  @Public()
  @Get('login')
  login(@Query('continue') continueTo: string | undefined, @Res({ passthrough: true }) res: Response): { redirect: string } {
    const state = randomBytes(32).toString('hex');
    const safeContinue = sanitizeContinue(continueTo);

    const isProd = this.cfg.nodeEnv === 'production';
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: STATE_TTL_SECONDS * 1000,
      path: '/auth/lark/callback',
    });
    if (safeContinue) {
      res.cookie(CONTINUE_COOKIE, safeContinue, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        maxAge: STATE_TTL_SECONDS * 1000,
        path: '/auth/lark/callback',
      });
    }

    const url = this.lark.buildAuthorizeUrl({ redirectUri: this.cfg.redirectUri, state });
    res.redirect(302, url);
    return { redirect: url };
  }
}

function sanitizeContinue(input: string | undefined): string | null {
  if (!input) return null;
  // Only allow same-origin paths starting with /
  if (!input.startsWith('/')) return null;
  if (input.startsWith('//')) return null; // protocol-relative URL
  if (input.length > 256) return null;
  return input;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --typecheck` (note: full controller including `/callback` lands in Task 12; the partial controller built here should typecheck cleanly with only `/login` handler).

- [ ] **Step 3: Commit (no standalone unit test — `/login` is covered by the OAuth e2e suite in Task 21)**

```bash
git add apps/api/src/auth/lark/lark.controller.ts
git commit -m "feat(api): GET /auth/lark/login — state cookie + 302 to Feishu authorize"
```

---

## Task 12: LarkController — GET /auth/lark/callback

**Files:**
- Modify: `apps/api/src/auth/lark/lark.controller.ts`

- [ ] **Step 1: Append callback handler — replace `apps/api/src/auth/lark/lark.controller.ts`** with full content (now containing both /login and /callback):

```typescript
import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';

import { Public } from '../decorators/public.decorator.js';
import { JwtAuthService } from '../jwt/jwt.service.js';
import { RefreshTokenService } from '../jwt/refresh-token.service.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  setAuthCookies,
  type CookieEnv,
} from '../jwt/jwt-cookie.helper.js';
import { LarkService } from './lark.service.js';

export const STATE_COOKIE = 'tp_lark_state';
export const CONTINUE_COOKIE = 'tp_lark_continue';
const STATE_TTL_SECONDS = 300;

export interface LarkConfig {
  redirectUri: string;
  nodeEnv: string;
  initialAdminLarkUserIds: string[];
  cookieEnv: CookieEnv;
}

@Controller('auth/lark')
export class LarkController {
  constructor(
    private readonly lark: LarkService,
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    @Inject('LARK_CONFIG') private readonly cfg: LarkConfig,
  ) {}

  @Public()
  @Get('login')
  login(
    @Query('continue') continueTo: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): void {
    const state = randomBytes(32).toString('hex');
    const safeContinue = sanitizeContinue(continueTo);
    const cookieOpts = {
      httpOnly: true,
      sameSite: this.cfg.nodeEnv === 'production' ? 'none' as const : 'lax' as const,
      secure: this.cfg.nodeEnv === 'production',
      maxAge: STATE_TTL_SECONDS * 1000,
      path: '/auth/lark/callback',
    };
    res.cookie(STATE_COOKIE, state, cookieOpts);
    if (safeContinue) res.cookie(CONTINUE_COOKIE, safeContinue, cookieOpts);

    const url = this.lark.buildAuthorizeUrl({ redirectUri: this.cfg.redirectUri, state });
    res.redirect(302, url);
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') stateParam: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!code || !stateParam) {
      throw new BadRequestException('Missing code or state');
    }

    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const stateCookie = cookies[STATE_COOKIE];
    if (!stateCookie || stateCookie !== stateParam) {
      throw new BadRequestException('Invalid OAuth state');
    }
    const continueTo = cookies[CONTINUE_COOKIE] ?? '/';

    // Clear single-use cookies
    const clearOpts = { path: '/auth/lark/callback' };
    res.clearCookie(STATE_COOKIE, clearOpts);
    res.clearCookie(CONTINUE_COOKIE, clearOpts);

    // Exchange code for user_access_token
    const tokenResp = await this.lark.exchangeCode({
      code,
      redirectUri: this.cfg.redirectUri,
    });
    const info = await this.lark.fetchUserInfo(tokenResp.access_token);

    // Upsert user — preserve role on existing users
    const shouldBeAdmin = this.cfg.initialAdminLarkUserIds.includes(info.user_id);
    const user = await this.prisma.user.upsert({
      where: { larkOpenId: info.open_id },
      update: {
        larkUnionId: info.union_id,
        larkUserId: info.user_id,
        name: info.name,
        email: info.email ?? null,
        avatarUrl: info.avatar_url,
        lastLoginAt: new Date(),
      },
      create: {
        larkOpenId: info.open_id,
        larkUnionId: info.union_id,
        larkUserId: info.user_id,
        name: info.name,
        email: info.email ?? null,
        avatarUrl: info.avatar_url,
        role: shouldBeAdmin ? 'admin' : 'user',
        lastLoginAt: new Date(),
      },
    });

    // Sign session tokens
    const { token: access, csrf } = this.jwt.sign({
      sub: user.id,
      role: user.role as 'admin' | 'user' | 'emergency_admin',
    });
    const { plaintext: refresh } = await this.refresh.create(user.id);

    setAuthCookies(res, this.cfg.cookieEnv, { access, refresh });

    // Append CSRF token to redirect URL — frontend reads it on landing and stashes in store.
    const finalUrl = appendQuery(continueTo, { csrf });
    res.redirect(302, finalUrl);
  }
}

function sanitizeContinue(input: string | undefined): string | null {
  if (!input) return null;
  if (!input.startsWith('/')) return null;
  if (input.startsWith('//')) return null;
  if (input.length > 256) return null;
  return input;
}

function appendQuery(path: string, params: Record<string, string>): string {
  const [base, query = ''] = path.split('?');
  const sp = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  return `${base}?${sp.toString()}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: clean (errors here mean something didn't import correctly — investigate).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/lark/lark.controller.ts
git commit -m "feat(api): GET /auth/lark/callback — exchange code, upsert user, sign JWT cookies"
```

---

## Task 13: LocalController — POST /auth/local/login

**Files:**
- Create: `apps/api/src/auth/local/local.controller.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/local/local.controller.ts`**

```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Response } from 'express';

import { Public } from '../decorators/public.decorator.js';
import { JwtAuthService } from '../jwt/jwt.service.js';
import { RefreshTokenService } from '../jwt/refresh-token.service.js';
import { setAuthCookies, type CookieEnv } from '../jwt/jwt-cookie.helper.js';

const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

@Controller('auth/local')
export class LocalController {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    @Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; csrf: string; mustChangePassword: boolean }> {
    const body = LoginBodySchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { localUsername: body.username } });
    if (!user || !user.localPasswordHash || user.role !== 'emergency_admin') {
      throw new UnauthorizedException('Invalid username or password');
    }
    const valid = await bcrypt.compare(body.password, user.localPasswordHash);
    if (!valid) throw new UnauthorizedException('Invalid username or password');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { token: access, csrf } = this.jwt.sign({ sub: user.id, role: 'emergency_admin' });
    const { plaintext: refreshTok } = await this.refresh.create(user.id);
    setAuthCookies(res, this.cookieEnv, { access, refresh: refreshTok });

    return { ok: true, csrf, mustChangePassword: user.mustChangePassword };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/local/local.controller.ts
git commit -m "feat(api): POST /auth/local/login (bcrypt) for emergency admin"
```

---

## Task 14: AuthController — POST /auth/logout + /auth/refresh

**Files:**
- Create: `apps/api/src/auth/controllers/auth.controller.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/controllers/auth.controller.ts`**

```typescript
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';

import { Public } from '../decorators/public.decorator.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { JwtAuthService, type JwtClaims } from '../jwt/jwt.service.js';
import { RefreshTokenService } from '../jwt/refresh-token.service.js';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type CookieEnv,
} from '../jwt/jwt-cookie.helper.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    private readonly cookieEnv: CookieEnv,
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: JwtClaims,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies[REFRESH_COOKIE];
    if (refreshToken) {
      const v = await this.refresh.verify(refreshToken);
      if (v && v.userId === user.sub) {
        await this.refresh.revoke(v.id);
      }
    }
    clearAuthCookies(res, this.cookieEnv);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh_(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; csrf: string }> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies[REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException('No refresh token');

    const v = await this.refresh.verify(refreshToken);
    if (!v) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.prisma.user.findUnique({ where: { id: v.userId } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    // Rotate refresh token: revoke old, issue new
    await this.refresh.revoke(v.id);
    const { plaintext: newRefresh } = await this.refresh.create(user.id);
    const { token: newAccess, csrf } = this.jwt.sign({
      sub: user.id,
      role: user.role as 'admin' | 'user' | 'emergency_admin',
    });
    setAuthCookies(res, this.cookieEnv, { access: newAccess, refresh: newRefresh });
    return { ok: true, csrf };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/controllers/auth.controller.ts
git commit -m "feat(api): POST /auth/logout + /auth/refresh (with rotation)"
```

---

## Task 15: MeController — GET /users/me

**Files:**
- Create: `apps/api/src/auth/controllers/me.controller.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/controllers/me.controller.ts`**

```typescript
import { Controller, Get, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { CurrentUser } from '../decorators/current-user.decorator.js';
import type { JwtClaims } from '../jwt/jwt.service.js';

export interface MeResponse {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user' | 'emergency_admin';
  mustChangePassword: boolean;
  csrf: string;
}

@Controller('users')
export class MeController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get('me')
  async me(@CurrentUser() jwt: JwtClaims): Promise<{ ok: true; user: MeResponse }> {
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new NotFoundException('User not found');
    return {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role as MeResponse['role'],
        mustChangePassword: user.mustChangePassword,
        csrf: jwt.csrf,
      },
    };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/controllers/me.controller.ts
git commit -m "feat(api): GET /users/me — return user profile + CSRF token from JWT"
```

---

## Task 16: EmergencyAdminBootstrap

**Files:**
- Create: `apps/api/src/auth/bootstrap/emergency-admin.bootstrap.ts`

- [ ] **Step 1: Implement `apps/api/src/auth/bootstrap/emergency-admin.bootstrap.ts`**

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export interface EmergencyAdminConfig {
  username: string;
  password: string | undefined;
}

@Injectable()
export class EmergencyAdminBootstrap implements OnModuleInit {
  private readonly logger = new Logger(EmergencyAdminBootstrap.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: EmergencyAdminConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { localUsername: this.cfg.username },
    });
    if (existing) {
      this.logger.log(`Emergency admin "${this.cfg.username}" already exists`);
      return;
    }
    if (!this.cfg.password) {
      this.logger.warn(
        `Emergency admin "${this.cfg.username}" not present and INITIAL_ADMIN_LOCAL_PASSWORD is unset. ` +
          `Set the env to bootstrap it.`,
      );
      return;
    }
    const hash = await bcrypt.hash(this.cfg.password, 12);
    await this.prisma.user.create({
      data: {
        localUsername: this.cfg.username,
        localPasswordHash: hash,
        role: 'emergency_admin',
        mustChangePassword: true,
        name: 'Emergency Admin',
      },
    });
    this.logger.log(
      `Created emergency admin "${this.cfg.username}". First login will require password change.`,
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @template-printing/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/bootstrap/emergency-admin.bootstrap.ts
git commit -m "feat(api): EmergencyAdminBootstrap — create local admin from env on startup"
```

---

## Task 17: AuthModule wiring + AppModule integration

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Create `apps/api/src/auth/auth.module.ts`**

```typescript
import { Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { validateEnv } from '../common/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmergencyAdminBootstrap } from './bootstrap/emergency-admin.bootstrap.js';
import { AuthController } from './controllers/auth.controller.js';
import { MeController } from './controllers/me.controller.js';
import { CsrfGuard } from './guards/csrf.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { JwtAuthService } from './jwt/jwt.service.js';
import { RefreshTokenService } from './jwt/refresh-token.service.js';
import { LarkController } from './lark/lark.controller.js';
import { LarkService } from './lark/lark.service.js';
import { LocalController } from './local/local.controller.js';
import type { CookieEnv } from './jwt/jwt-cookie.helper.js';

const env = validateEnv();

const cookieEnv: CookieEnv = {
  nodeEnv: env.NODE_ENV,
  cookieDomain: env.COOKIE_DOMAIN,
  accessTtlSeconds: env.JWT_TTL_SECONDS,
  refreshTtlSeconds: env.REFRESH_TTL_SECONDS,
};

const providers: Provider[] = [
  {
    provide: JwtAuthService,
    useFactory: () => new JwtAuthService(env.JWT_SECRET, env.JWT_TTL_SECONDS),
  },
  {
    provide: RefreshTokenService,
    useFactory: (prisma: PrismaService) => new RefreshTokenService(prisma, env.REFRESH_TTL_SECONDS),
    inject: [PrismaService],
  },
  {
    provide: LarkService,
    useFactory: () =>
      new LarkService({
        appId: env.LARK_SSO_APP_ID,
        appSecret: env.LARK_SSO_APP_SECRET,
        passportBase: env.LARK_PASSPORT_BASE,
        openBase: env.LARK_API_BASE,
        accountsBase: env.LARK_ACCOUNTS_BASE,
      }),
  },
  {
    provide: 'LARK_CONFIG',
    useValue: {
      redirectUri: env.LARK_SSO_REDIRECT_URI,
      nodeEnv: env.NODE_ENV,
      initialAdminLarkUserIds: env.INITIAL_ADMIN_LARK_USER_IDS
        ? env.INITIAL_ADMIN_LARK_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      cookieEnv,
    },
  },
  { provide: 'COOKIE_ENV', useValue: cookieEnv },
  {
    provide: EmergencyAdminBootstrap,
    useFactory: (prisma: PrismaClient) =>
      new EmergencyAdminBootstrap(prisma, {
        username: env.INITIAL_ADMIN_LOCAL_USERNAME,
        password: env.INITIAL_ADMIN_LOCAL_PASSWORD,
      }),
    inject: [PrismaService],
  },
  // Global guards: JWT first, then CSRF, then Roles
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: CsrfGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  providers,
  controllers: [LarkController, LocalController, AuthController, MeController],
  exports: [JwtAuthService, RefreshTokenService],
})
export class AuthModule {}
```

> Note: `AuthController` will receive `cookieEnv` via positional constructor injection because we passed `cookieEnv` directly as the 4th arg. NestJS resolves it via DI tokens — we need to align. Adjust `auth.controller.ts` constructor parameter to use `@Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv` if not already.

- [ ] **Step 2: Fix AuthController constructor to use injection token**

Open `apps/api/src/auth/controllers/auth.controller.ts` and ensure the constructor reads:

```typescript
import { Inject } from '@nestjs/common';
// ...
constructor(
  private readonly jwt: JwtAuthService,
  private readonly refresh: RefreshTokenService,
  private readonly prisma: PrismaClient,
  @Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv,
) {}
```

(Replace the existing `private readonly cookieEnv: CookieEnv,` parameter to add the `@Inject` decorator + import.)

- [ ] **Step 3: Replace `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module.js';
import { pinoConfig } from './common/logger.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(pinoConfig(process.env.NODE_ENV ?? 'development')),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Update `apps/api/src/main.ts` to install cookie-parser and helmet**

Replace `apps/api/src/main.ts`:

```typescript
import 'reflect-metadata';

import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { validateEnv } from './common/env.js';
import { GlobalExceptionFilter } from './common/exception.filter.js';

async function bootstrap(): Promise<void> {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(cookieParser());
  app.use(
    helmet({
      // CSP managed by SecurityHeadersMiddleware in Task 18.
      contentSecurityPolicy: false,
    }),
  );
  app.enableCors({
    origin: true, // reflect request origin (we restrict via SameSite + CSP)
    credentials: true,
  });
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
```

- [ ] **Step 5: Build to verify wiring**

Run: `pnpm --filter @template-printing/api build`
Expected: build succeeds.

- [ ] **Step 6: Boot api briefly to verify no DI errors**

Start postgres + redis if not already:
```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
```

Run api in dev mode in background and check logs:
```bash
pnpm --filter @template-printing/api dev &
APIPID=$!
sleep 8
curl -sS http://localhost:3000/healthz
kill $APIPID 2>/dev/null
```

Expected: `/healthz` returns `{"ok":true,...}` and the log shows the EmergencyAdminBootstrap message ("already exists" or "not present and INITIAL_ADMIN_LOCAL_PASSWORD is unset" depending on env). No DI resolution errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/auth.module.ts apps/api/src/app.module.ts apps/api/src/main.ts apps/api/src/auth/controllers/auth.controller.ts
git commit -m "feat(api): wire AuthModule with global guards + cookie-parser + helmet + CORS"
```

---

## Task 18: SecurityHeadersMiddleware (CSP for Lark webview)

**Files:**
- Create: `apps/api/src/common/security-headers.middleware.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/common/security-headers.middleware.ts`**

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // Allow embedding in Lark / Feishu webviews and self
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
```

- [ ] **Step 2: Register middleware in AppModule**

Update `apps/api/src/app.module.ts`:

```typescript
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module.js';
import { pinoConfig } from './common/logger.js';
import { SecurityHeadersMiddleware } from './common/security-headers.middleware.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(pinoConfig(process.env.NODE_ENV ?? 'development')),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @template-printing/api build`
Expected: clean.

- [ ] **Step 4: Verify headers**

In background:
```bash
pnpm --filter @template-printing/api dev &
APIPID=$!
sleep 6
curl -sI http://localhost:3000/healthz | grep -E "Content-Security-Policy|X-Content-Type-Options"
kill $APIPID 2>/dev/null
```

Expected: CSP header includes `frame-ancestors 'self' https://*.feishu.cn`, and `X-Content-Type-Options: nosniff` is present.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/security-headers.middleware.ts apps/api/src/app.module.ts
git commit -m "feat(api): CSP header allowing Feishu/Lark webview embedding + nosniff"
```

---

## Task 19: Frontend api wrapper + AuthStore

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/auth-routes.ts`
- Create: `apps/web/src/stores/auth.ts`

- [ ] **Step 1: Create `apps/web/src/lib/auth-routes.ts`**

```typescript
export const LOGIN_PATH = '/login';
export const HOME_PATH = '/';

export function buildLarkLoginUrl(continueTo?: string): string {
  const sp = new URLSearchParams();
  if (continueTo) sp.set('continue', continueTo);
  const qs = sp.toString();
  return `/api/auth/lark/login${qs ? `?${qs}` : ''}`;
}
```

- [ ] **Step 2: Create `apps/web/src/lib/api.ts`** — fetch wrapper that injects CSRF header and parses unified ApiError

```typescript
export interface ApiError {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfTokenGetter: () => string | null = () => null;

export function setCsrfTokenGetter(fn: () => string | null): void {
  csrfTokenGetter = fn;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = csrfTokenGetter();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : ({} as unknown);
  if (!res.ok) {
    const err = json as ApiError;
    throw new ApiClientError(
      res.status,
      err.error?.code ?? 'ERROR',
      err.error?.message ?? res.statusText,
      err.error?.details,
    );
  }
  return json as T;
}
```

- [ ] **Step 3: Create `apps/web/src/stores/auth.ts`**

```typescript
import { defineStore } from 'pinia';

import { apiFetch, ApiClientError, setCsrfTokenGetter } from '../lib/api.js';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user' | 'emergency_admin';
  mustChangePassword: boolean;
}

interface MeResponse {
  ok: true;
  user: AuthUser & { csrf: string };
}

interface LocalLoginResponse {
  ok: true;
  csrf: string;
  mustChangePassword: boolean;
}

interface RefreshResponse {
  ok: true;
  csrf: string;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AuthUser | null,
    csrf: null as string | null,
    loading: true,
  }),
  getters: {
    isAuthenticated: (s): boolean => s.user !== null,
  },
  actions: {
    async hydrate(): Promise<void> {
      this.loading = true;
      try {
        const { user } = await apiFetch<MeResponse>('/users/me');
        const { csrf, ...rest } = user;
        this.user = rest;
        this.csrf = csrf;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          // Try refresh once before giving up
          await this.tryRefresh();
        } else {
          this.user = null;
          this.csrf = null;
        }
      } finally {
        this.loading = false;
      }
    },
    async tryRefresh(): Promise<void> {
      try {
        const { csrf } = await apiFetch<RefreshResponse>('/auth/refresh', { method: 'POST' });
        this.csrf = csrf;
        // After refresh, fetch /users/me without triggering another refresh attempt
        const { user } = await apiFetch<MeResponse>('/users/me');
        const { csrf: csrf2, ...rest } = user;
        this.user = rest;
        this.csrf = csrf2;
      } catch {
        this.user = null;
        this.csrf = null;
      }
    },
    setLocalLoginResult(r: LocalLoginResponse, fetchUserAfter = true): Promise<void> {
      this.csrf = r.csrf;
      if (fetchUserAfter) return this.hydrate();
      return Promise.resolve();
    },
    async logout(): Promise<void> {
      try {
        await apiFetch('/auth/logout', { method: 'POST' });
      } finally {
        this.user = null;
        this.csrf = null;
      }
    },
  },
});

// Hook the csrf token getter into the api client
export function installCsrfHook(): void {
  setCsrfTokenGetter(() => useAuthStore().csrf);
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @template-printing/web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ apps/web/src/stores/
git commit -m "feat(web): apiFetch wrapper (CSRF auto-attach) + Pinia auth store"
```

---

## Task 20: Frontend LoginView + AppHeader + router guard

**Files:**
- Create: `apps/web/src/views/LoginView.vue`
- Create: `apps/web/src/views/LoginCallbackView.vue`
- Create: `apps/web/src/components/AppHeader.vue`
- Modify: `apps/web/src/views/HomeView.vue`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/App.vue`
- Modify: `apps/web/src/main.ts`

- [ ] **Step 1: Create `apps/web/src/views/LoginView.vue`**

```vue
<script setup lang="ts">
import { ElButton, ElCard, ElForm, ElFormItem, ElInput, ElMessage, ElDivider } from 'element-plus';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { buildLarkLoginUrl } from '../lib/auth-routes.js';
import { apiFetch, ApiClientError } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const submitting = ref(false);
const showEmergency = ref(false);

function goLark(): void {
  const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
  window.location.assign(buildLarkLoginUrl(continueTo));
}

async function submitLocal(): Promise<void> {
  if (!username.value || !password.value) return;
  submitting.value = true;
  try {
    const result = await apiFetch<{ ok: true; csrf: string; mustChangePassword: boolean }>(
      '/auth/local/login',
      {
        method: 'POST',
        body: JSON.stringify({ username: username.value, password: password.value }),
      },
    );
    await authStore.setLocalLoginResult(result);
    ElMessage.success('登录成功');
    await router.push('/');
  } catch (e) {
    if (e instanceof ApiClientError) {
      ElMessage.error(e.message);
    } else {
      ElMessage.error('登录失败，请重试');
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <ElCard class="login-card">
      <h1 class="login-title">模板打印平台</h1>
      <p class="login-subtitle">请使用飞书账号登录</p>

      <ElButton type="primary" size="large" style="width: 100%" @click="goLark">
        飞书登录
      </ElButton>

      <ElDivider>
        <span class="login-divider-text">或</span>
      </ElDivider>

      <ElButton link size="small" @click="showEmergency = !showEmergency">
        应急管理员登录 {{ showEmergency ? '▲' : '▼' }}
      </ElButton>

      <ElForm v-if="showEmergency" label-position="top" style="margin-top: 12px">
        <ElFormItem label="用户名">
          <ElInput v-model="username" autocomplete="username" />
        </ElFormItem>
        <ElFormItem label="密码">
          <ElInput v-model="password" type="password" autocomplete="current-password" />
        </ElFormItem>
        <ElButton
          type="default"
          :loading="submitting"
          style="width: 100%"
          @click="submitLocal"
        >
          应急登录
        </ElButton>
      </ElForm>
    </ElCard>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
}
.login-card {
  width: 380px;
  padding: 24px;
}
.login-title {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 600;
}
.login-subtitle {
  margin: 0 0 24px 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.login-divider-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
```

- [ ] **Step 2: Create `apps/web/src/views/LoginCallbackView.vue`** — captures `?csrf=` from URL after Lark redirect

```vue
<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth.js';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

onMounted(async () => {
  const csrf = route.query.csrf as string | undefined;
  if (csrf) authStore.csrf = csrf;
  await authStore.hydrate();
  // Clean ?csrf= from URL by replacing
  await router.replace({ path: route.path, query: { ...route.query, csrf: undefined } });
});
</script>

<template>
  <main style="padding: 32px">
    <p>正在登录...</p>
  </main>
</template>
```

> Note: We are not using a dedicated callback route in this MVP — the Lark backend redirect lands directly on the requested `continue` path (e.g. `/?csrf=xxx`). HomeView.vue handles capturing `csrf` from the query. We keep `LoginCallbackView.vue` for completeness in case future flows route through it explicitly.

- [ ] **Step 3: Create `apps/web/src/components/AppHeader.vue`**

```vue
<script setup lang="ts">
import { ElAvatar, ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

async function logout(): Promise<void> {
  await auth.logout();
  ElMessage.success('已退出');
  await router.push('/login');
}
</script>

<template>
  <header class="app-header">
    <div class="left">
      <strong>模板打印平台</strong>
    </div>
    <div class="right">
      <ElDropdown v-if="auth.user" trigger="click">
        <span class="user-trigger">
          <ElAvatar
            v-if="auth.user.avatarUrl"
            :src="auth.user.avatarUrl"
            :size="28"
          />
          <span class="user-name">{{ auth.user.name ?? auth.user.id }}</span>
        </span>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem disabled>{{ auth.user.role }}</ElDropdownItem>
            <ElDropdownItem divided @click="logout">退出登录</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <ElButton v-else size="small" @click="router.push('/login')">登录</ElButton>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
}
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.user-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
</style>
```

- [ ] **Step 4: Replace `apps/web/src/views/HomeView.vue`**

```vue
<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

onMounted(async () => {
  // If we landed here from Lark callback, capture csrf in query and then strip it
  const csrf = route.query.csrf as string | undefined;
  if (csrf) {
    auth.csrf = csrf;
    await auth.hydrate();
    await router.replace({ path: route.path, query: { ...route.query, csrf: undefined } });
  }
});
</script>

<template>
  <main style="padding: 32px">
    <h1>欢迎回来{{ auth.user?.name ? `, ${auth.user.name}` : '' }}</h1>
    <p>设计器 + 模板中心将在 Plan 2 + Plan 3 中实现。</p>
  </main>
</template>
```

- [ ] **Step 5: Replace `apps/web/src/router/index.ts`** with guard

```typescript
import { createRouter, createWebHistory } from 'vue-router';

import { useAuthStore } from '../stores/auth.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      meta: { requiresAuth: true },
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      meta: { requiresAuth: false },
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/login/callback',
      name: 'login-callback',
      meta: { requiresAuth: false },
      component: () => import('../views/LoginCallbackView.vue'),
    },
  ],
});

let hydrated = false;

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!hydrated) {
    await auth.hydrate();
    hydrated = true;
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { continue: to.fullPath } };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/' };
  }
  return true;
});

export default router;
```

- [ ] **Step 6: Replace `apps/web/src/App.vue`**

```vue
<script setup lang="ts">
import { useAuthStore } from './stores/auth.js';

import AppHeader from './components/AppHeader.vue';

const auth = useAuthStore();
</script>

<template>
  <AppHeader v-if="auth.user || !auth.loading" />
  <RouterView />
</template>
```

- [ ] **Step 7: Replace `apps/web/src/main.ts`** — install the csrf hook

```typescript
import 'element-plus/dist/index.css';
import './styles/theme.css';

import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router/index.js';
import { installCsrfHook } from './stores/auth.js';

const app = createApp(App);
app.use(createPinia());
installCsrfHook();
app.use(router);
app.use(ElementPlus);
app.mount('#app');
```

- [ ] **Step 8: Build frontend**

Run: `pnpm --filter @template-printing/web build`
Expected: success.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): login page + AppHeader + router guard + Lark callback handling"
```

---

## Task 21: E2E tests — Lark OAuth + local login + refresh + logout

**Files:**
- Create: `apps/api/test/auth-lark.e2e.spec.ts`
- Create: `apps/api/test/auth-local.e2e.spec.ts`
- Create: `apps/api/test/auth-refresh.e2e.spec.ts`

- [ ] **Step 1: Create `apps/api/test/auth-lark.e2e.spec.ts`** — mocks Feishu HTTP via nock

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import nock from 'nock';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';

describe('Lark OAuth e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    nock.enableNetConnect();
    await app.close();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('GET /auth/lark/login sets state cookie and redirects to Feishu authorize', async () => {
    const res = await request(app.getHttpServer()).get('/auth/lark/login').expect(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.feishu\.cn\/open-apis\/authen\/v1\/index/);
    expect(res.headers['set-cookie']?.join(';')).toMatch(/tp_lark_state=/);
  });

  it('GET /auth/lark/callback completes upsert + signs JWT cookies', async () => {
    // First get the state cookie
    const loginRes = await request(app.getHttpServer()).get('/auth/lark/login').expect(302);
    const cookies = (loginRes.headers['set-cookie'] as string[]).join('; ');
    const stateMatch = cookies.match(/tp_lark_state=([0-9a-f]+)/);
    if (!stateMatch) throw new Error('No state cookie');
    const state = stateMatch[1];

    // Mock Feishu APIs
    nock('https://passport.feishu.cn')
      .post('/suite/passport/oauth/token')
      .reply(200, {
        access_token: 'user-at',
        token_type: 'Bearer',
        expires_in: 7200,
        refresh_token: 'user-rt',
        scope: 'contact:user.base:readonly',
      });
    nock('https://open.feishu.cn')
      .get('/open-apis/authen/v1/user_info')
      .reply(200, {
        code: 0,
        msg: 'ok',
        data: {
          open_id: 'ou_e2e_' + Date.now(),
          union_id: 'on_e2e',
          user_id: 'uid_e2e',
          name: 'E2E User',
          email: 'e2e@example.com',
          avatar_url: 'https://example.com/avatar.png',
        },
      });

    const callbackRes = await request(app.getHttpServer())
      .get(`/auth/lark/callback?code=fake-code&state=${state}`)
      .set('Cookie', cookies)
      .expect(302);

    // Should redirect to / with ?csrf=...
    expect(callbackRes.headers.location).toMatch(/^\/\?csrf=[0-9a-f]+$/);
    const setCookies = (callbackRes.headers['set-cookie'] as string[]).join(';');
    expect(setCookies).toMatch(/tp_access=/);
    expect(setCookies).toMatch(/tp_refresh=/);
  });

  it('callback rejects mismatched state', async () => {
    const loginRes = await request(app.getHttpServer()).get('/auth/lark/login').expect(302);
    const cookies = (loginRes.headers['set-cookie'] as string[]).join('; ');
    await request(app.getHttpServer())
      .get('/auth/lark/callback?code=fake&state=wrong-state')
      .set('Cookie', cookies)
      .expect(400);
  });
});
```

- [ ] **Step 2: Create `apps/api/test/auth-local.e2e.spec.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';

describe('Local emergency login e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const TEST_USERNAME = 'e2e_emergency';
  const TEST_PASSWORD = 'password-e2e-1';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.user.create({
      data: {
        localUsername: TEST_USERNAME,
        localPasswordHash: await bcrypt.hash(TEST_PASSWORD, 10),
        role: 'emergency_admin',
        mustChangePassword: false,
        name: 'Test Emergency',
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /auth/local/login succeeds for valid creds', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.csrf).toMatch(/^[0-9a-f]+$/);
    const setCookies = (res.headers['set-cookie'] as string[]).join(';');
    expect(setCookies).toMatch(/tp_access=/);
    expect(setCookies).toMatch(/tp_refresh=/);
  });

  it('rejects wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: 'wrong' })
      .expect(401);
  });

  it('rejects unknown user', async () => {
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: 'nonexistent', password: 'x' })
      .expect(401);
  });
});
```

- [ ] **Step 3: Create `apps/api/test/auth-refresh.e2e.spec.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';

describe('Refresh + logout e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const TEST_USERNAME = 'e2e_refresh';
  const TEST_PASSWORD = 'password-refresh-1';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.user.create({
      data: {
        localUsername: TEST_USERNAME,
        localPasswordHash: await bcrypt.hash(TEST_PASSWORD, 10),
        role: 'emergency_admin',
        name: 'Test Refresh',
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  async function loginAndGetCookies(): Promise<{ cookies: string; csrf: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    return {
      cookies: (res.headers['set-cookie'] as string[]).join('; '),
      csrf: res.body.csrf,
    };
  }

  it('GET /users/me returns user with valid cookie', async () => {
    const { cookies } = await loginAndGetCookies();
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.user.role).toBe('emergency_admin');
  });

  it('GET /users/me returns 401 without cookie', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('POST /auth/refresh rotates tokens', async () => {
    const { cookies } = await loginAndGetCookies();
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.ok).toBe(true);
    const newCookies = (res.headers['set-cookie'] as string[]).join(';');
    expect(newCookies).toMatch(/tp_access=/);
    expect(newCookies).toMatch(/tp_refresh=/);
  });

  it('POST /auth/logout revokes refresh + clears cookies', async () => {
    const { cookies, csrf } = await loginAndGetCookies();
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    const cleared = (res.headers['set-cookie'] as string[]).join(';');
    expect(cleared).toMatch(/tp_access=;/);
    expect(cleared).toMatch(/tp_refresh=;/);
  });

  it('POST /auth/refresh fails after the refresh cookie is revoked', async () => {
    const { cookies, csrf } = await loginAndGetCookies();
    // Logout to revoke
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    // Reuse the same refresh cookie
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(401);
  });

  it('POST /auth/logout without CSRF token is rejected', async () => {
    const { cookies } = await loginAndGetCookies();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .expect(403);
  });
});
```

- [ ] **Step 4: Set env vars for tests and run**

The e2e tests need the same env shape as production. Create a `.env.test` if not present, OR run with env inline:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/template_printing \
  REDIS_URL=redis://localhost:6379 \
  JWT_SECRET=$(node -e "console.log('a'.repeat(32))") \
  FILE_SIG_SECRET=$(node -e "console.log('a'.repeat(32))") \
  MASTER_KEY=$(node -e "console.log('a'.repeat(64))") \
  LARK_SSO_APP_ID=cli_test \
  LARK_SSO_APP_SECRET=secret_test \
  LARK_SSO_REDIRECT_URI=http://localhost:3000/auth/lark/callback \
  NODE_ENV=test \
  pnpm --filter @template-printing/api test:e2e
```

Expected: all 3 e2e files pass.

- [ ] **Step 5: Add npm script for e2e with env**

Modify `apps/api/package.json` `scripts.test:e2e` to NOT change the existing testRegex — but ensure the `.env.test` is loaded. Simplest path: create a `.env.test` at `apps/api/.env.test` and reference it from `jest.config.cjs` via `setupFiles`:

Create `apps/api/test/setup.ts`:

```typescript
import * as dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
```

Install dotenv:
```bash
pnpm --filter @template-printing/api add -D dotenv@16.4.5
```

Edit `apps/api/jest.config.cjs` to add `setupFiles`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@template-printing/types$': '<rootDir>/../../packages/types/src/index.ts',
    '^@template-printing/schema$': '<rootDir>/../../packages/schema/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
```

Create `apps/api/.env.test` (committed; uses placeholder secrets):

```bash
NODE_ENV=test
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/template_printing
REDIS_URL=redis://localhost:6379
JWT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FILE_SIG_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
MASTER_KEY=0000000000000000000000000000000000000000000000000000000000000000
LARK_SSO_APP_ID=cli_test
LARK_SSO_APP_SECRET=secret_test
LARK_SSO_REDIRECT_URI=http://localhost:3000/auth/lark/callback
INITIAL_ADMIN_LARK_USER_IDS=
INITIAL_ADMIN_LOCAL_USERNAME=emergency_admin
```

> Note: `.env.test` is committed (it has placeholder secrets, none of them are real). Add a comment at top of file noting this.

- [ ] **Step 6: Run all tests**

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
pnpm --filter @template-printing/api test
```

Expected: every existing test plus the new auth tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/ apps/api/jest.config.cjs apps/api/.env.test apps/api/package.json pnpm-lock.yaml
git commit -m "test(api): e2e for Lark OAuth, local login, refresh, logout — with .env.test"
```

---

## Plan 1 Done — Acceptance Criteria

Before declaring Plan 1 complete, verify:

- [ ] `pnpm typecheck` passes for api + web + render + packages.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes — including all new auth tests (>= 20 new assertions).
- [ ] `pnpm build` succeeds across all packages.
- [ ] Postgres + Redis containers run; `prisma migrate dev --name init_auth` produces a committed migration directory.
- [ ] Local stack (`docker compose -f docker-compose.dev.yml up -d`) brings up api / web / postgres / redis healthy.
- [ ] Manually verify the login flow:
  1. Visit `http://localhost:5173/` — router pushes to `/login`.
  2. Click "飞书登录" — redirects to `accounts.feishu.cn` (cannot complete without a real Feishu app — that's fine for local).
  3. (Backdoor for testing without real Feishu) Apply seed: `INITIAL_ADMIN_LOCAL_PASSWORD=changeme123 docker compose ... up -d api` → click "应急管理员登录" → enter `emergency_admin` / `changeme123` → land on `/` with username in header.
  4. Click avatar → "退出登录" → redirected to `/login`.
- [ ] CSP header present on responses, allowing Feishu webview embedding.
- [ ] Refresh token rotates on `/auth/refresh` and is revoked on `/auth/logout`.

After acceptance, move to **Plan 2 — Designer**.
