# 用户管理（CRUD + 禁用 + 角色 + 本地登录打通 + UserStateService）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能管理全部用户（列表/新建本地账号/改角色/重置密码/禁用启用），并打通本地账号登录、让禁用与降级经 UserStateService 缓存"下一请求即生效"。

**Architecture:** 新增 `apps/api/src/users/` 模块（admin 守卫）。新增 `UserStateService`（进程内 TTL 缓存 `userId→{role,disabledAt}|null`，主动 evict）。`JwtAuthGuard`/`ApiAuthGuard` cookie 路径改为查 user-state（禁用/不存在→401，用 DB role 覆盖 JWT role）；Bearer 路径在 `ApiTokenService.verify()` 查 `disabledAt`。本地登录放开为"任意未禁用 + 有本地密码"，按真实 role 签发。飞书与 `localUsername` 解耦。

**Tech Stack:** NestJS + Prisma(PostgreSQL) + zod（apps/api，测试 jest + supertest 真实 DB）；Vue3 + Pinia + Element Plus（apps/web）。

**验证约定（本项目既有方式）：**
- 后端单测/e2e（**真实 dev DB**，jest+supertest，`Test.createTestingModule({imports:[AppModule]})` + `cookieParser`）：
  `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs <testfile> --runInBand --forceExit"`
- typecheck：`docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit"` / web `pnpm exec vue-tsc --noEmit -p tsconfig.json`。
- 改后端代码后 `docker restart template_printing-api`（容器名已无 -1）。
- 前端：vue-tsc + Playwright（chromium-1208，`--no-proxy-server`，登录 admin/admin123）。
- pre-commit 钩子在 **host** 跑 lint-staged（`*.ts` eslint，`*.vue` 仅 prettier）。`@nestjs/*`/`@prisma/client`/`zod` import 需 `// eslint-disable-next-line import/no-unresolved`（照抄邻近行）。Conventional Commits，commit 前**勿** `--no-verify`。

---

## Phase A — DB + 鉴权基础设施

### Task A1: Prisma 迁移（disabledAt + 解耦清理）

**Files:** Modify `apps/api/prisma/schema.prisma`

- [ ] **Step 1: 给 `model User` 加列**（在 `mustChangePassword` 行附近）：

```prisma
  disabledAt          DateTime? @map("disabled_at")
```

- [ ] **Step 2: 生成迁移（不直接 apply，先看 SQL）**

Run:
```bash
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec prisma migrate dev --name decouple_lark_local_username_and_disable_users --create-only"
```

- [ ] **Step 3: 在生成的 `migration.sql` 末尾追加受限清理语句**（编辑 `apps/api/prisma/migrations/<ts>_decouple_lark_local_username_and_disable_users/migration.sql`）：

```sql
-- 解耦：飞书自动建号曾写 local_username=user_id；仅清理"无本地密码且是飞书账号"的历史 dev 数据，绝不动有本地密码的用户
UPDATE "users" SET "local_username" = NULL
WHERE "local_password_hash" IS NULL AND "lark_open_id" IS NOT NULL;
```
确认文件里只有 `ALTER TABLE "users" ADD COLUMN "disabled_at"` + 上面这条 UPDATE，无任何 DROP / data-loss。

- [ ] **Step 4: 应用 + 重新生成 client + 重启**

Run:
```bash
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec prisma migrate deploy && pnpm exec prisma generate" && docker restart template_printing-api
```
Expected: 迁移成功；等 ~12s 后 `docker logs --tail 3 template_printing-api` 显示 `Nest application successfully started`。

- [ ] **Step 5: 验证列存在 + dev 飞书账号 local_username 已清空**

Run:
```bash
docker exec template_printing-postgres psql -U postgres -d template_printing -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='disabled_at'; SELECT count(*) AS lark_with_localname FROM users WHERE lark_open_id IS NOT NULL AND local_password_hash IS NULL AND local_username IS NOT NULL;"
```
Expected: `disabled_at` 列存在；`lark_with_localname` = 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): users.disabled_at + 解耦飞书 local_username 迁移"
```

### Task A2: UserStateService（缓存）+ AuthModule 装配

**Files:**
- Create: `apps/api/src/auth/user-state.service.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/test/user-state-service.spec.ts`

- [ ] **Step 1: 写失败单测**

```ts
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UserStateService } from '../src/auth/user-state.service.js';

describe('UserStateService', () => {
  const prisma = new PrismaClient();
  const svc = new UserStateService(prisma as unknown as PrismaService);
  let id: string;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: 'us-test', role: 'user' } });
    id = u.id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('returns {role,disabledAt} for existing user', async () => {
    const s = await svc.get(id);
    expect(s).not.toBeNull();
    expect(s!.role).toBe('user');
    expect(s!.disabledAt).toBeNull();
  });

  it('returns null for non-existent user', async () => {
    expect(await svc.get('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('evict() forces a re-read (sees role change)', async () => {
    await svc.get(id); // prime cache
    await prisma.user.update({ where: { id }, data: { role: 'admin' } });
    expect((await svc.get(id))!.role).toBe('user'); // still cached
    svc.evict(id);
    expect((await svc.get(id))!.role).toBe('admin'); // fresh
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/user-state-service.spec.ts --runInBand --forceExit"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `user-state.service.ts`**

```ts
// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserState {
  role: 'admin' | 'user' | 'emergency_admin';
  disabledAt: Date | null;
}

interface CacheEntry {
  value: UserState | null; // null = 用户不存在
  expiresAt: number;
}

const TTL_MS = 10_000; // 兜底：主动 evict 才是即时失效的依据

@Injectable()
export class UserStateService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** 命中缓存即返回；未命中查 DB；用户不存在返回 null。 */
  async get(userId: string): Promise<UserState | null> {
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, disabledAt: true },
    });
    const value: UserState | null = row
      ? { role: row.role as UserState['role'], disabledAt: row.disabledAt }
      : null;
    this.cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  /** 角色/禁用变更后主动失效 → 下一请求即生效。 */
  evict(userId: string): void {
    this.cache.delete(userId);
  }
}
```

- [ ] **Step 4: AuthModule 装配** — `apps/api/src/auth/auth.module.ts`：把 `UserStateService` 加入 `providers` 数组，并加入 `exports`：

```ts
// providers 数组里加： UserStateService,
// exports 改为：
  exports: [JwtAuthService, RefreshTokenService, ApiTokenService, UserStateService],
```
（顶部 import：`// eslint-disable-next-line import/no-unresolved` + `import { UserStateService } from './user-state.service.js';`）

- [ ] **Step 5: 运行确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/user-state-service.spec.ts --runInBand --forceExit"`
Expected: PASS（3/3）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/user-state.service.ts apps/api/src/auth/auth.module.ts apps/api/test/user-state-service.spec.ts
git commit -m "feat(auth): UserStateService 进程内 TTL 缓存（role/disabledAt，主动 evict）"
```

### Task A3: JwtAuthGuard 改 async（user-state 校验 + role 覆盖）

**Files:**
- Modify: `apps/api/src/auth/guards/jwt-auth.guard.ts`
- Modify (既有单测，签名/异步变化必须同步更新): `apps/api/test/jwt-auth-guard.spec.ts`

- [ ] **Step 0: 先更新既有单测**（构造函数加 UserStateService stub、`canActivate` 改 await，并补 disabled/null/role-override 用例）—— 整体替换 `apps/api/test/jwt-auth-guard.spec.ts`：

```ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line import/no-unresolved
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../src/auth/jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../src/auth/jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import type { UserState, UserStateService } from '../src/auth/user-state.service.js';

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const jwt = new JwtAuthService('a'.repeat(32), 60);
  let stateValue: UserState | null;
  const userState = { get: async () => stateValue } as unknown as UserStateService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    stateValue = { role: 'admin', disabledAt: null };
    guard = new JwtAuthGuard(reflector, jwt, userState);
  });

  function mockCtx(cookies: Record<string, string> = {}): ExecutionContext {
    const req: Record<string, unknown> = { cookies };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows public endpoints without a cookie', async () => {
    const saveGet = reflector.getAllAndOverride;
    reflector.getAllAndOverride = (() => true) as typeof saveGet;
    expect(await guard.canActivate(mockCtx())).toBe(true);
    reflector.getAllAndOverride = saveGet;
  });

  it('rejects when no access cookie', async () => {
    await expect(guard.canActivate(mockCtx())).rejects.toThrow(UnauthorizedException);
  });

  it('attaches user and overrides role from DB state', async () => {
    const { token } = jwt.sign({ sub: 'u-1', role: 'user' }); // JWT says user
    stateValue = { role: 'admin', disabledAt: null }; // DB says admin → override
    const ctx = mockCtx({ [ACCESS_COOKIE]: token });
    expect(await guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { sub: string; role: string } };
    expect(req.user?.sub).toBe('u-1');
    expect(req.user?.role).toBe('admin');
  });

  it('rejects invalid token', async () => {
    await expect(guard.canActivate(mockCtx({ [ACCESS_COOKIE]: 'garbage' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects disabled user', async () => {
    const { token } = jwt.sign({ sub: 'u-2', role: 'admin' });
    stateValue = { role: 'admin', disabledAt: new Date() };
    await expect(guard.canActivate(mockCtx({ [ACCESS_COOKIE]: token }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects missing user (state null)', async () => {
    const { token } = jwt.sign({ sub: 'u-3', role: 'admin' });
    stateValue = null;
    await expect(guard.canActivate(mockCtx({ [ACCESS_COOKIE]: token }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
```
Run（确认对旧实现编译/运行失败）：`docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/jwt-auth-guard.spec.ts --runInBand --forceExit"` → Expected: FAIL（构造函数 3 参 / async 不匹配）。

- [ ] **Step 1: 改实现**（注入 UserStateService；`canActivate` 改 async）：

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line import/no-unresolved
import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { UserStateService } from '../user-state.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtAuthService,
    private readonly userState: UserStateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const token = cookies[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('No access token');

    let claims;
    try {
      claims = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // DB/缓存最新状态：用户不存在或被禁用 → 拒绝；用最新 role 覆盖 JWT role
    const state = await this.userState.get(claims.sub);
    if (!state || state.disabledAt) {
      throw new UnauthorizedException('account_disabled_or_missing');
    }
    req.user = { ...claims, role: state.role };
    return true;
  }
}
```

- [ ] **Step 2: 运行单测确认通过 + typecheck + 重启**

Run:
```bash
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/jwt-auth-guard.spec.ts --runInBand --forceExit && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api
```
Expected: 单测 6/6 PASS；`EXIT=0`；重启成功。（APP_GUARD 注入 UserStateService 已由 A2 的 AuthModule provider 提供。）

- [ ] **Step 3: 烟测（现有 admin 仍可用，证明没破坏）**

Run（登录后取 cookie 访 /users/me）：
```bash
cd /tmp && rm -f cj.txt && curl -s --noproxy '*' -c cj.txt -X POST http://localhost:5173/api/auth/local/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' -o /dev/null && curl -s --noproxy '*' -b cj.txt http://localhost:5173/api/users/me -w '\n[%{http_code}]\n'
```
Expected: `[200]`（emergency_admin 正常）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/guards/jwt-auth.guard.ts apps/api/test/jwt-auth-guard.spec.ts
git commit -m "feat(auth): JwtAuthGuard 改 async + user-state 校验/role 覆盖（禁用/降级即时生效）"
```

### Task A4: ApiAuthGuard cookie 路径复用 + Bearer 路径禁用校验 + revokeAllForUser

**Files:**
- Modify: `apps/api/src/auth/guards/api-auth.guard.ts`
- Modify: `apps/api/src/auth/api-token/api-token.service.ts`

- [ ] **Step 1: `ApiTokenService.verify()` 查 owner.disabledAt** — 改 `include` 与判断：

```ts
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true, disabledAt: true } } },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.user.disabledAt) return null; // owner 被禁用 → 拒绝
```

- [ ] **Step 2: 加 `revokeAllForUser()`**（接 `revoke()` 之后，镜像 refresh-token 的实现）：

```ts
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
```

- [ ] **Step 3: `ApiAuthGuard` cookie 路径复用 user-state**（注入 UserStateService；替换 Path 2 的 verify 块）：

```ts
  constructor(
    private readonly tokens: ApiTokenService,
    private readonly jwt: JwtAuthService,
    private readonly userState: UserStateService,
  ) {}
```
Path 2（cookie）里，把 `req.user = this.jwt.verify(cookieToken);` 之后加上 user-state 校验 + role 覆盖：

```ts
    let claims;
    try {
      claims = this.jwt.verify(cookieToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    const state = await this.userState.get(claims.sub);
    if (!state || state.disabledAt) throw new UnauthorizedException('account_disabled_or_missing');
    req.user = { ...claims, role: state.role };
```
（顶部加 `// eslint-disable-next-line import/no-unresolved` + `import { UserStateService } from '../user-state.service.js';`；CSRF 块保持不变，在其后。）

- [ ] **Step 4: typecheck + 重启**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api`
Expected: `EXIT=0`。

- [ ] **Step 5: 烟测（API token 仍可渲染）** — 用现有登录创建一个 token 并调 `/api/render` 不在本任务范围；此处仅确认 typecheck + 启动即可（A 阶段末 A5 有禁用 e2e 覆盖 token 路径）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/guards/api-auth.guard.ts apps/api/src/auth/api-token/api-token.service.ts
git commit -m "feat(auth): ApiAuthGuard cookie 复用 user-state + Bearer 校验 owner 禁用 + revokeAllForUser"
```

### Task A5: 本地登录打通（真实 role）+ 禁用拒绝（e2e）

**Files:**
- Modify: `apps/api/src/auth/local/local.controller.ts`
- Test: `apps/api/test/local-login-roles.e2e.spec.ts`

- [ ] **Step 1: 写失败 e2e**（普通本地 admin 账号能登录且签真实 role；禁用后拒绝）：

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

describe('Local login for non-emergency accounts', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const U = 'e2e_localadmin';
  const P = 'pw-e2e-localadmin-1';
  let id: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: U } });
    const u = await prisma.user.create({
      data: { localUsername: U, localPasswordHash: await bcrypt.hash(P, 10), role: 'admin', name: 'L Admin' },
    });
    id = u.id;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: U } });
    await prisma.$disconnect();
    await app.close();
  });

  it('non-emergency local account can log in', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: U, password: P })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('disabled local account is rejected', async () => {
    await prisma.user.update({ where: { id }, data: { disabledAt: new Date() } });
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: U, password: P })
      .expect(401);
    await prisma.user.update({ where: { id }, data: { disabledAt: null } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/local-login-roles.e2e.spec.ts --runInBand --forceExit"`
Expected: FAIL（当前非 emergency_admin 登录返回 401）。

- [ ] **Step 3: 改 `local.controller.ts` login**（放开限制 + 真实 role + 禁用拒绝）。替换校验与签发：

```ts
    const user = await this.prisma.user.findUnique({ where: { localUsername: body.username } });
    if (!user || !user.localPasswordHash) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.disabledAt) throw new UnauthorizedException('account_disabled');
    const valid = await bcrypt.compare(body.password, user.localPasswordHash);
    if (!valid) throw new UnauthorizedException('Invalid username or password');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const { token: access, csrf } = this.jwt.sign({ sub: user.id, role: user.role as 'admin' | 'user' | 'emergency_admin' });
```
（即：删除 `user.role !== 'emergency_admin'` 条件；签发用 `user.role` 而非固定 `'emergency_admin'`。）

- [ ] **Step 4: 重启 + 运行确认通过**

Run: `docker restart template_printing-api && sleep 12 && docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/local-login-roles.e2e.spec.ts --runInBand --forceExit"`
Expected: PASS（2/2）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/local/local.controller.ts apps/api/test/local-login-roles.e2e.spec.ts
git commit -m "feat(auth): 本地登录放开为任意未禁用+有本地密码用户，按真实 role 签发"
```

### Task A6: 飞书解耦 + /me/password 不再 fallback

**Files:**
- Modify: `apps/api/src/auth/lark/lark.controller.ts`
- Modify: `apps/api/src/auth/controllers/me.controller.ts`

- [ ] **Step 1: lark.controller 建号去掉 localUsername** — 删除 create data 里的 `localUsername: info.user_id,` 行（及其上方两行注释）。

- [ ] **Step 2: lark.controller 调整欢迎 IM 文案**（不再承诺用户名密码登录）。把 `sendTextToUser` 的文本改为：

```ts
          `欢迎使用模板打印平台！您的账号已自动创建，可直接用飞书登录。`,
```

- [ ] **Step 3: lark.controller 登录拒绝被禁用用户** — 在已存在用户分支（`if (user) {...}` 更新 lastLoginAt 之前）加：若 `user.disabledAt` → 拒绝。具体：找到查到已存在 `user` 后、签发 JWT 前，插入：

```ts
      if (user.disabledAt) throw new UnauthorizedException('account_disabled');
```
（顶部确认已 import `UnauthorizedException`；没有则加到 `@nestjs/common` import。）

- [ ] **Step 4: me.controller `setPassword` 去 fallback** — 替换 `localUsername` 兜底逻辑（当前 `me.controller.ts:124`）。在 `const wasSet = ...` 之后加无 localUsername 守卫，并把 update 的 data 去掉 localUsername 写入：

```ts
    const wasSet = Boolean(user.localPasswordHash);
    if (!wasSet && !user.localUsername) {
      // 飞书用户尚无本地登录名 → 本迭代不支持经此接口创建本地登录能力
      throw new BadRequestException('local_username_required');
    }
    if (wasSet) {
      if (!dto.currentPassword) throw new BadRequestException('current_password_required');
      const ok = await bcrypt.compare(dto.currentPassword, user.localPasswordHash!);
      if (!ok) throw new BadRequestException('current_password_incorrect');
    }
    const hash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: jwt.sub },
      data: { localPasswordHash: hash, mustChangePassword: false }, // 不再写 localUsername（已有则保留）
    });
```

- [ ] **Step 5: typecheck + 重启**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api`
Expected: `EXIT=0`。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/lark/lark.controller.ts apps/api/src/auth/controllers/me.controller.ts
git commit -m "feat(auth): 飞书建号不再写 localUsername + /me/password 去 larkUserId 兜底"
```

---

## Phase B — users 模块（CRUD + 安全）

### Task B1: users 模块骨架 + 列表（含 can 能力位）

**Files:**
- Create: `apps/api/src/users/users.service.ts`, `users.controller.ts`, `users.module.ts`
- Modify: `apps/api/src/app.module.ts`（imports 加 UsersModule）
- Test: `apps/api/test/users-list.e2e.spec.ts`

- [ ] **Step 1: 写失败 e2e（列表分页 + 形状 + can）**

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

async function loginAdmin(app: INestApplication, prisma: PrismaClient) {
  // 用 emergency_admin 'admin'（bootstrap）登录拿 cookie
  const res = await request(app.getHttpServer())
    .post('/auth/local/login').send({ username: 'admin', password: 'admin123' });
  return (res.headers['set-cookie'] as unknown as string[]);
}

describe('GET /admin/users', () => {
  let app: INestApplication; const prisma = new PrismaClient(); let cookies: string[];
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.use(cookieParser()); await app.init();
    cookies = await loginAdmin(app, prisma);
  });
  afterAll(async () => { await prisma.$disconnect(); await app.close(); });

  it('returns paginated shape with can fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/users?page=1&pageSize=10').set('Cookie', cookies).expect(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body.page).toBe(1);
    const me = res.body.items.find((u: any) => u.role === 'emergency_admin');
    expect(me).toBeTruthy();
    expect(me.can).toHaveProperty('disable');
    expect(me.can.disable).toBe(false); // emergency_admin 不可被禁用
    expect(me.accountType).toBeDefined();
  });

  it('rejects non-admin (no cookie) with 401', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });
});
```
（注：`admin/admin123` 是 bootstrap emergency_admin；若密码不同，beforeAll 里先重置该用户密码。）

- [ ] **Step 2: 运行确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/users-list.e2e.spec.ts --runInBand --forceExit"`
Expected: FAIL（404，路由不存在）。

- [ ] **Step 3: 实现 service 列表 + can 规则**（`users.service.ts`）：

```ts
// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Prisma } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface ListArgs {
  page: number; pageSize: number; search?: string;
  role?: 'user' | 'admin' | 'emergency_admin';
  status?: 'active' | 'disabled';
  type?: 'lark' | 'local' | 'both';
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meId: string, args: ListArgs) {
    const page = Math.max(args.page, 1);
    const pageSize = Math.min(Math.max(args.pageSize, 1), 100);
    const where: Prisma.UserWhereInput = {};
    if (args.search) {
      const q = args.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { localUsername: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { larkUserId: { contains: q } },
      ];
    }
    if (args.role) where.role = args.role;
    if (args.status === 'active') where.disabledAt = null;
    if (args.status === 'disabled') where.disabledAt = { not: null };
    if (args.type === 'lark') where.larkOpenId = { not: null };
    if (args.type === 'local') where.localPasswordHash = { not: null };
    // 'both': 两者都非空 —— 用 AND 叠加
    if (args.type === 'both') where.AND = [{ larkOpenId: { not: null } }, { localPasswordHash: { not: null } }];

    const [rows, total, activeAdminCount] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, name: true, email: true, role: true, localUsername: true, larkUserId: true,
          larkOpenId: true, localPasswordHash: true, disabledAt: true, lastLoginAt: true, createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { role: 'admin', disabledAt: null } }),
    ]);

    const items = rows.map((u) => {
      const hasLarkBinding = u.larkOpenId != null;
      const hasLocalPassword = u.localPasswordHash != null;
      const accountType: 'lark' | 'local' | 'both' =
        hasLarkBinding && hasLocalPassword ? 'both' : hasLarkBinding ? 'lark' : 'local';
      const accountLabel = accountType === 'both' ? '飞书+本地' : accountType === 'lark' ? '飞书' : '本地';
      const isSelf = u.id === meId;
      const isEmergency = u.role === 'emergency_admin';
      const isLastAdmin = u.role === 'admin' && u.disabledAt == null && activeAdminCount <= 1;
      let disabledReason: string | null = null;
      if (isSelf) disabledReason = 'cannot_modify_self';
      else if (isEmergency) disabledReason = 'emergency_admin_protected';
      else if (isLastAdmin) disabledReason = 'last_admin_protected';
      const blocked = isSelf || isEmergency || isLastAdmin;
      return {
        id: u.id, name: u.name, email: u.email, role: u.role,
        localUsername: u.localUsername, larkUserId: u.larkUserId,
        hasLocalPassword, hasLarkBinding, accountType, accountLabel,
        disabled: u.disabledAt != null,
        can: {
          disable: !blocked,
          changeRole: !blocked,
          resetPassword: hasLocalPassword && !isEmergency,
        },
        disabledReason,
        lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      };
    });
    return { items, total, page, pageSize };
  }
}
```

- [ ] **Step 4: 实现 controller + module**（`users.controller.ts`）：

```ts
import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';
// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { Roles } from '../auth/guards/roles.guard.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../auth/jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { UsersService } from './users.service.js';

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  role: z.enum(['user', 'admin', 'emergency_admin']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  type: z.enum(['lark', 'local', 'both']).optional(),
});

@Controller('admin/users')
@Roles('admin', 'emergency_admin')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  async list(@CurrentUser() me: JwtClaims, @Query() rawQuery: unknown) {
    const parsed = ListQuery.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.list(me.sub, parsed.data);
  }
}
```
`users.module.ts`：

```ts
// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { AuthModule } from '../auth/auth.module.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaModule } from '../prisma/prisma.module.js';
// eslint-disable-next-line import/no-unresolved
import { UsersController } from './users.controller.js';
// eslint-disable-next-line import/no-unresolved
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```
（确认 `PrismaModule` 路径与既有模块一致——若 Prisma 是 global module 则可省 import；照搬 templates.module 的 import 方式。）
`app.module.ts`：`imports` 数组加 `UsersModule`（照搬现有 import 风格 + eslint-disable）。

- [ ] **Step 5: 重启 + 运行确认通过**

Run: `docker restart template_printing-api && sleep 12 && docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm jest --config jest.config.cjs test/users-list.e2e.spec.ts --runInBand --forceExit"`
Expected: PASS（2/2）。若 `admin/admin123` 密码不符，在 test beforeAll 里 `prisma.user.update` 重置 emergency_admin 密码后再登录。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users apps/api/src/app.module.ts apps/api/test/users-list.e2e.spec.ts
git commit -m "feat(api): users 模块 + GET /admin/users（分页/过滤/can 能力位）"
```

### Task B2: 新建本地账号（一次性密码 + 409）

**Files:**
- Modify: `apps/api/src/users/users.service.ts`, `users.controller.ts`
- Test: `apps/api/test/users-create.e2e.spec.ts`

- [ ] **Step 1: 写失败 e2e**（创建返回明文 + 撞名 409）：

```ts
// …harness 同 B1，loginAdmin 拿 cookies + 拿 csrf（POST 需 X-CSRF-Token）…
it('creates local account, returns one-time plaintext', async () => {
  const csrf = /* 从 login 响应体取 res.body.csrf */;
  const res = await request(app.getHttpServer())
    .post('/admin/users').set('Cookie', cookies).set('X-CSRF-Token', csrf)
    .send({ localUsername: 'e2e_created_1', name: '新建测试', role: 'user' }).expect(201);
  expect(res.body.plaintext).toMatch(/.{12,}/);
  expect(res.body.user.localUsername).toBe('e2e_created_1');
  await prisma.user.deleteMany({ where: { localUsername: 'e2e_created_1' } });
});
it('409 on duplicate username', async () => {
  const csrf = /* … */;
  await prisma.user.create({ data: { localUsername: 'e2e_dup_1', role: 'user', name: 'dup' } });
  await request(app.getHttpServer()).post('/admin/users').set('Cookie', cookies).set('X-CSRF-Token', csrf)
    .send({ localUsername: 'e2e_dup_1', name: 'x', role: 'user' }).expect(409);
  await prisma.user.deleteMany({ where: { localUsername: 'e2e_dup_1' } });
});
```
（登录响应 `res.body.csrf` 提供 CSRF；non-safe 方法需带 `X-CSRF-Token` header，见 CsrfGuard/ApiAuthGuard 约定。）

- [ ] **Step 2: 运行确认失败** — Run 同 B1 的命令（指向 users-create）。Expected: FAIL（404/未实现）。

- [ ] **Step 3: service 加 `createLocal()`**：

```ts
import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
// …
  async createLocal(input: { localUsername: string; name: string; role: 'user' | 'admin'; email?: string }) {
    const exists = await this.prisma.user.findUnique({ where: { localUsername: input.localUsername }, select: { id: true } });
    if (exists) throw new ConflictException('username_taken');
    const plaintext = randomBytes(9).toString('base64url'); // ~12 字符随机
    const user = await this.prisma.user.create({
      data: {
        localUsername: input.localUsername, name: input.name, email: input.email ?? null,
        role: input.role, localPasswordHash: await bcrypt.hash(plaintext, 12), mustChangePassword: true,
      },
      select: { id: true, localUsername: true, name: true, role: true, email: true },
    });
    return { plaintext, user };
  }
```

- [ ] **Step 4: controller 加 POST + 审计**（注入 AuditLogService，照搬 templates.controller 审计写法）：

```ts
const CreateDto = z.object({
  localUsername: z.string().trim().min(3).max(64),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['user', 'admin']),
  email: z.string().email().optional(),
});

  @Post()
  async create(@CurrentUser() me: JwtClaims, @Body() rawBody: unknown, @Req() req: Request) {
    const parsed = CreateDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.svc.createLocal(parsed.data);
    void this.audit.log({
      actor: { id: me.sub, name: null }, action: 'user.create',
      resourceType: 'user', resourceId: result.user.id,
      details: { localUsername: result.user.localUsername, role: result.user.role }, request: req,
    });
    return result;
  }
```
（import `Body, Post, Req`；`import type { Request } from 'express'`；`AuditLogService` 注入 + UsersModule imports 已含 AuthModule，审计模块按现有方式 import。）

- [ ] **Step 5: 重启 + 确认通过** — Run 指向 users-create。Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users apps/api/test/users-create.e2e.spec.ts
git commit -m "feat(api): POST /admin/users 新建本地账号（一次性密码 + 409 撞名 + 审计）"
```

### Task B3: 改角色 + 安全规则（事务 FOR UPDATE，含真并发测试）

**Files:**
- Modify: `apps/api/src/users/users.service.ts`, `users.controller.ts`
- Test: `apps/api/test/users-role-safety.e2e.spec.ts`

- [ ] **Step 1: 写失败 e2e（含并发）**：

```ts
// harness 同上。准备：emergency_admin(admin) + 两个普通 admin a1,a2 + 自己。
it('cannot demote self', async () => { /* PATCH /admin/users/<me.id>/role {role:'user'} → 400/403 */ });
it('cannot change emergency_admin role', async () => { /* 目标 emergency_admin → 403 */ });
it('concurrent demote of last two admins keeps >=1', async () => {
  // 建 a1,a2 role=admin（active），确保系统里活跃 admin 恰为 a1,a2（清理其它 e2e admin）
  const [r1, r2] = await Promise.allSettled([
    request(app.getHttpServer()).patch(`/admin/users/${a1}/role`).set('Cookie', cookies).set('X-CSRF-Token', csrf).send({ role: 'user' }),
    request(app.getHttpServer()).patch(`/admin/users/${a2}/role`).set('Cookie', cookies).set('X-CSRF-Token', csrf).send({ role: 'user' }),
  ]);
  const codes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
  // 一个 200 一个 409
  expect(codes).toContain(200);
  expect(codes).toContain(409);
  const remaining = await prisma.user.count({ where: { role: 'admin', disabledAt: null, id: { in: [a1, a2] } } });
  expect(remaining).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败** — Expected: FAIL（路由未实现）。

- [ ] **Step 3: service 加 `changeRole()`（FOR UPDATE 行锁事务）**：

```ts
import { ForbiddenException } from '@nestjs/common';
// …
  /** 改角色；目标降 admin→user 时事务内对活跃 admin 行加锁，保证不归零。 */
  async changeRole(meId: string, targetId: string, role: 'user' | 'admin') {
    if (targetId === meId) throw new ForbiddenException('cannot_modify_self');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, disabledAt: true } });
    if (!target) throw new ForbiddenException('user_not_found');
    if (target.role === 'emergency_admin') throw new ForbiddenException('emergency_admin_protected');
    if (target.role === role) return { id: targetId, role };

    await this.prisma.$transaction(async (tx) => {
      // 降级（admin→user）需保证仍有活跃 admin
      if (target.role === 'admin' && role === 'user') {
        const admins = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE`;
        const remaining = admins.filter((a) => a.id !== targetId).length;
        if (remaining < 1) throw new ConflictException('last_admin_protected');
      }
      await tx.user.update({ where: { id: targetId }, data: { role } });
    });
    return { id: targetId, role };
  }
```

- [ ] **Step 4: controller 加 PATCH :id/role + 审计 + evict**（角色变更必须 `userState.evict(targetId)`）：

```ts
  @Patch(':id/role')
  async changeRole(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Body() rawBody: unknown, @Req() req: Request) {
    const parsed = z.object({ role: z.enum(['user', 'admin']) }).safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const r = await this.svc.changeRole(me.sub, id, parsed.data.role);
    this.userState.evict(id); // 下一请求即生效
    void this.audit.log({ actor: { id: me.sub, name: null }, action: 'user.role.change', resourceType: 'user', resourceId: id, details: { role: parsed.data.role }, request: req });
    return r;
  }
```
（注入 `UserStateService`（来自 AuthModule export）；import `Patch, Param`。）

- [ ] **Step 5: 重启 + 确认通过**（并发用例需真打 DB；jest 真实 DB 满足）。Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users apps/api/test/users-role-safety.e2e.spec.ts
git commit -m "feat(api): PATCH 改角色 + 安全规则(自己/emergency/最后admin FOR UPDATE 事务) + evict"
```

### Task B4: 重置密码（仅本地账号）

**Files:** Modify `apps/api/src/users/users.service.ts`, `users.controller.ts`; Test `apps/api/test/users-reset-password.e2e.spec.ts`

- [ ] **Step 1: 写失败 e2e**：本地账号 reset 返回新明文；对纯飞书账号(无 localPasswordHash) reset → 400；对 emergency_admin → 403。

```ts
it('reset local account returns new plaintext', async () => {
  // 建本地账号 u(role user, has password) → POST /admin/users/<u>/reset-password → 200 plaintext
});
it('400 for account without local password', async () => {
  // 建纯飞书账号(larkOpenId set, no localPasswordHash) → 400
});
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: service `resetPassword()`**：

```ts
  async resetPassword(targetId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, localPasswordHash: true } });
    if (!u) throw new ForbiddenException('user_not_found');
    if (u.role === 'emergency_admin') throw new ForbiddenException('emergency_admin_protected');
    if (!u.localPasswordHash) throw new BadRequestException('not_a_local_account');
    const plaintext = randomBytes(9).toString('base64url');
    await this.prisma.user.update({ where: { id: targetId }, data: { localPasswordHash: await bcrypt.hash(plaintext, 12), mustChangePassword: true } });
    return { plaintext };
  }
```
（`BadRequestException` import。）

- [ ] **Step 4: controller 加 POST :id/reset-password + 审计**（`user.password.reset`）：

```ts
  @Post(':id/reset-password')
  async resetPassword(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Req() req: Request) {
    const result = await this.svc.resetPassword(id);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'user.password.reset',
      resourceType: 'user',
      resourceId: id,
      request: req,
    });
    return result; // { plaintext }
  }
```

- [ ] **Step 5: 重启 + 确认通过** —— Run 指向 `test/users-reset-password.e2e.spec.ts`，Expected: PASS。

- [ ] **Step 6: Commit** `feat(api): POST 重置密码（仅本地账号，一次性明文 + 审计）`

### Task B5: 禁用 / 启用（吊销 token + evict）

**Files:** Modify `apps/api/src/users/users.service.ts`, `users.controller.ts`; Test `apps/api/test/users-disable.e2e.spec.ts`

- [ ] **Step 1: 写失败 e2e**：禁用后该用户 cookie 访问受保护接口**下一请求** 401；refresh 401；其 Bearer API token 调用被拒；不能禁用自己/emergency/最后 admin。

```ts
it('disabled user is rejected on next request (cookie)', async () => {
  // 建本地 user u + 登录拿 u 的 cookie + 访 /users/me 200
  // admin 调 POST /admin/users/<u>/disable
  // 再用 u 的 cookie 访 /users/me → 401（evict 后下一请求即生效）
});
it('cannot disable last active admin', async () => { /* 仅一个活跃 admin 时 disable → 409 */ });
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: service `setDisabled()`（FOR UPDATE 同 B3 思路）**：

```ts
  async setDisabled(meId: string, targetId: string, disabled: boolean) {
    if (disabled && targetId === meId) throw new ForbiddenException('cannot_modify_self');
    const t = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, disabledAt: true } });
    if (!t) throw new ForbiddenException('user_not_found');
    if (disabled && t.role === 'emergency_admin') throw new ForbiddenException('emergency_admin_protected');
    await this.prisma.$transaction(async (tx) => {
      if (disabled && t.role === 'admin' && t.disabledAt == null) {
        const admins = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE`;
        if (admins.filter((a) => a.id !== targetId).length < 1) throw new ConflictException('last_admin_protected');
      }
      await tx.user.update({ where: { id: targetId }, data: { disabledAt: disabled ? new Date() : null } });
    });
    return { id: targetId, disabled };
  }
```

- [ ] **Step 4: controller POST :id/disable + :id/enable**（disable 调 `revokeAll` + `evict`；enable 仅 evict + 审计）：

```ts
  @Post(':id/disable')
  async disable(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.setDisabled(me.sub, id, true);
    await this.refresh.revokeAllForUser(id);
    await this.apiTokens.revokeAllForUser(id);
    this.userState.evict(id);
    void this.audit.log({ actor: { id: me.sub, name: null }, action: 'user.disable', resourceType: 'user', resourceId: id, request: req });
    return r;
  }

  @Post(':id/enable')
  async enable(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Req() req: Request) {
    const r = await this.svc.setDisabled(me.sub, id, false);
    this.userState.evict(id);
    void this.audit.log({ actor: { id: me.sub, name: null }, action: 'user.enable', resourceType: 'user', resourceId: id, request: req });
    return r;
  }
```
（注入 `RefreshTokenService`、`ApiTokenService`、`UserStateService`（均 AuthModule export）。）

- [ ] **Step 5: 重启 + 确认通过。**

- [ ] **Step 6: Commit** `feat(api): POST 禁用/启用（吊销 refresh+API token + evict，安全规则）`

---

## Phase C — 前端

### Task C1: UsersAdminView 真实页（表格 + 过滤 + 分页）

**Files:** Modify `apps/web/src/views/admin/UsersAdminView.vue`

- [ ] **Step 1: 实现页面** —— 复用 `BrandPagination` + `ConfirmDialog`，调 `apiFetch`。结构：page-bar（已有 brand 风格，沿用 §改动 8 后的）+ 过滤栏（search/role/status/type）+ 表格（名称/账号(accountLabel + localUsername|larkUserId)/角色徽章/类型/状态/最近登录/操作）。行操作按 `item.can.*` 置灰（`:disabled` + `:title=disabledReason`）。`fetchUsers({page,pageSize,search,role,status,type})` → `apiFetch('/admin/users?'+qs)`。改角色用下拉（user/admin），禁用/启用/重置密码用按钮 + ConfirmDialog。

> 由于该文件较大，实现时参照 `RenderLogsView.vue`（过滤栏 + 表格 + sec-head + BrandPagination）和 `ApiView.vue` Tokens tab（一次性明文 dialog）现成模式照搬，颜色/字体走 yangli 变量。

- [ ] **Step 2: typecheck**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 3: Playwright 验证** —— 登录 admin → /admin/users：表格有数据；过滤 role=admin 生效；emergency_admin 行的禁用/改角色按钮置灰。

- [ ] **Step 4: Commit** `feat(web): 用户管理页 — 列表/过滤/分页/能力位置灰`

### Task C2: 新建本地账号 dialog + 一次性密码 dialog + 改角色/重置/禁用 接线

**Files:** Modify `apps/web/src/views/admin/UsersAdminView.vue`

- [ ] **Step 1: 接线 mutations** —— 「新建本地账号」按钮 → ElDialog（localUsername/name/role/email?）→ `POST /admin/users` → 成功后弹一次性明文密码 dialog（复用 ApiView Tokens 的明文展示 + 复制按钮模式）。改角色 → `PATCH /admin/users/:id/role`。重置密码 → `POST /admin/users/:id/reset-password` → 同一次性明文 dialog。禁用/启用 → `POST .../disable|enable` + ConfirmDialog。每次 mutation 成功后 `fetchUsers()` 刷新。错误 toast 显示后端 code（如 `last_admin_protected`→中文提示映射）。

- [ ] **Step 2: typecheck** —— 同 C1 Step 2，`EXIT=0`。

- [ ] **Step 3: Playwright 验证** —— 新建本地账号→明文 dialog 出现；改角色 user→admin 列表刷新；禁用一个普通用户→状态变"已禁用"；尝试禁用最后一个 admin→toast 报 `last_admin_protected`。

- [ ] **Step 4: Commit** `feat(web): 用户管理 — 新建/改角色/重置密码/禁用 接线 + 一次性密码弹框`

### Task C3: MustChangePasswordDialog 文案中性化

**Files:** Modify `apps/web/src/components/MustChangePasswordDialog.vue`

- [ ] **Step 1: 改文案** —— 把偏 emergency-admin 的措辞改为通用「初始/临时密码」语境（如标题「请修改初始密码」、说明「您正在使用初始/临时密码，请设置新密码后继续」）。保留 currentPassword 字段（后端有密码时仍校验）。不改逻辑。

- [ ] **Step 2: typecheck** —— `EXIT=0`。

- [ ] **Step 3: Playwright 验证** —— 用 admin 新建一个本地账号拿到一次性密码 → 用该账号登录 → 强制改密弹窗出现、文案为中性「初始/临时密码」→ 输入当前(一次性)密码 + 新密码 → 改密成功 → 可正常进入。
Expected: 端到端：admin 建号→新账号登录→改密→可用，全链路通。

- [ ] **Step 4: Commit** `feat(web): 强制改密弹窗文案中性化（初始/临时密码）`

---

## Phase D — 文档同步

### Task D1: PROGRESS + AGENTS.md

**Files:** Modify `docs/PROGRESS.md`, `AGENTS.md`

- [ ] **Step 1: PROGRESS.md** —— 顶部「最近更新」日期；第 3 节追加用户管理条目（CRUD/禁用即时生效机制/本地登录打通/解耦）；第 2 节「已交付能力」补「用户管理」；第 5 节路线表把「Admin 用户管理 CRUD」标 ✅。

- [ ] **Step 2: AGENTS.md** —— 第 2 节目录结构补 `apps/api/src/users/`；若鉴权流程描述涉及（UserStateService / 本地登录范围 / 禁用），按第 9 节触发映射补一句。

- [ ] **Step 3: Commit** `docs: 用户管理特性 — PROGRESS 近期变更 + AGENTS 目录结构`

---

## 自检清单（收尾前）

- [ ] api 全量测试通过：`docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test"`（含新增 user-state / local-login / users-* e2e）
- [ ] api + web typecheck 全绿
- [ ] 手测关键路径：admin 建本地账号→新账号真实 role 登录→强制改密；禁用某用户→下一请求 cookie/refresh/Bearer 全 401；admin→user 降级下一请求 admin 接口 403；禁用/降级最后一个 admin 被 409；emergency_admin 受保护
- [ ] 没提交 .env / storage / 测试输出
- [ ] AGENTS.md 第 9 节触发映射的 docs 已同步
- [ ] commit 前缀规范，未跳过 hooks
