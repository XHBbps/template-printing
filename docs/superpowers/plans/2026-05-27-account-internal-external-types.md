# 账号内部/外部双类型 + 身份展示 + 权限强制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把账号收敛为两类互斥(飞书SSO=内部 / 本地账号密码=外部,初始账号=内部超管),据此驱动权限(外部禁公共模板、禁 API、禁授权 admin),按类型重构个人中心,新增内部 `mobile` 与外部 `externalCode`(W+8位),并把"应急管理员"更名为"超级管理员";移除会死锁的「解绑飞书」。

**Architecture:** 分类**纯派生**(`isInternal = larkOpenId != null || role === 'emergency_admin'`),不加分类列;仅 additive 加 `mobile`/`externalCode` 两可空列。后端在签发 api-token、changeRole、可见性三处强制权限;前端按 `isInternal` 渲染个人中心、按规则约束角色下拉、统一角色文案。

**Tech Stack:** NestJS + Prisma(PostgreSQL)+ Zod;Vue3 + Pinia + Element Plus;vitest(单测)+ supertest(e2e)。

**Spec:** `docs/superpowers/specs/2026-05-27-account-internal-external-types-design.md`

**全局约定(容器内跑命令):**
- api:`docker exec template_printing-api sh -c "cd /workspace/apps/api && <cmd>"`(typecheck/lint/test/prisma 都在此容器)
- web:`docker exec template_printing-web sh -c "cd /workspace/apps/web && <cmd>"`
- schema:`docker exec template_printing-api sh -c "cd /workspace/packages/schema && <cmd>"`
- 提交走 husky,**不** `--no-verify`;每个任务只 `git add` 本任务文件;提交信息用规范前缀。
- 迁移底线:**禁** `migrate reset` / `db push --accept-data-loss`;只加可空列。

---

## File Structure

**后端**
- `apps/api/prisma/schema.prisma` —— `User` 加 `mobile`、`externalCode`(T1)。
- `apps/api/prisma/migrations/<ts>_add_mobile_external_code/migration.sql` —— additive SQL(T1)。
- `apps/api/src/auth/account-kind.ts`(新)—— `isInternal/isExternal` 纯函数(T2)。
- `apps/api/test/account-kind.spec.ts`(新)—— 单测(T2)。
- `apps/api/src/auth/lark/lark.controller.ts` —— 登录写 `mobile`(T3)。
- `apps/api/src/users/users.service.ts` —— `createLocal` 分配 `externalCode` + 强制 user;`changeRole` 内部才可 admin;列表派生 internal/external(T4、T7)。
- `apps/api/src/users/users.controller.ts` —— 建号 role 入参收敛(T4)。
- `apps/api/src/auth/controllers/me.controller.ts` —— `MeResponse` 增字段;删 `unbindLark`;`setPassword` 仅改密;`updateProfile` 内部只读(T5)。
- `apps/api/src/auth/api-token/api-token.controller.ts` + `api-token.service.ts` + `guards/api-auth.guard.ts` —— 外部禁 API(T6)。
- `apps/api/test/*.e2e.spec.ts` —— 新增/补充 e2e(T4、T6、T7)。

**前端**
- `apps/web/src/views/MeView.vue` —— 按类型展示 + 删解绑 + 密码区按 `hasLocalPassword`(T8)。
- `apps/web/src/views/admin/UsersAdminView.vue` —— 角色文案 + 下拉规则 + 内部/外部标签(T9)。
- `apps/web/src/views/admin/AuditLogView.vue` —— 角色文案(T9)。
- 鉴权 store / `MeResponse` 前端类型 —— 增 `isInternal/mobile/externalCode`(T5、T8)。

**文档**
- `docs/PROGRESS.md`、`docs/qa/template-module-verification-checklist.md`、spec 状态(T10)。

---

## Task 1: Prisma 加 `mobile` / `externalCode`(additive 迁移)

**Files:** Modify `apps/api/prisma/schema.prisma`(`model User`);Create migration。

- [ ] **Step 1: 改 schema**

在 `apps/api/prisma/schema.prisma` 的 `model User` 内,`avatarUrl` 行后加 `mobile`,`localUsername` 行后加 `externalCode`:
```prisma
  avatarUrl           String?   @map("avatar_url")
  mobile              String?   @map("mobile")
  ...
  localUsername       String?   @unique @map("local_username")
  externalCode        String?   @unique @map("external_code")
```

- [ ] **Step 2: 生成迁移(create-only,审核 SQL)**

Run:
```
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec prisma migrate dev --name add_mobile_external_code --create-only"
```
打开生成的 `apps/api/prisma/migrations/<ts>_add_mobile_external_code/migration.sql`,确认仅含:
```sql
ALTER TABLE "users" ADD COLUMN "mobile" TEXT;
ALTER TABLE "users" ADD COLUMN "external_code" TEXT;
CREATE UNIQUE INDEX "users_external_code_key" ON "users"("external_code");
```
若出现任何 `DROP` / `NOT NULL` 无默认 / 重置语句,**停止**并修正(只能 additive 可空列)。

- [ ] **Step 3: 应用迁移 + 重新生成 client**

Run:
```
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec prisma migrate deploy && pnpm exec prisma generate"
```
Expected: 迁移 applied,client 重新生成,无错误。

- [ ] **Step 4: typecheck**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck"`
Expected: 通过(新列出现在 Prisma 类型中)。

- [ ] **Step 5: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): User 加 mobile / external_code 可空列（additive 迁移）"
```

---

## Task 2: `account-kind` 判定工具 + 单测

**Files:** Create `apps/api/src/auth/account-kind.ts`;Test `apps/api/test/account-kind.spec.ts`。

- [ ] **Step 1: 写失败测试**

`apps/api/test/account-kind.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isInternal, isExternal } from '../src/auth/account-kind.js';

describe('account-kind', () => {
  it('飞书账号 = 内部', () => {
    expect(isInternal({ larkOpenId: 'ou_x', role: 'user' })).toBe(true);
  });
  it('超级管理员(无飞书)= 内部', () => {
    expect(isInternal({ larkOpenId: null, role: 'emergency_admin' })).toBe(true);
  });
  it('本地账号(非超管)= 外部', () => {
    expect(isInternal({ larkOpenId: null, role: 'user' })).toBe(false);
    expect(isExternal({ larkOpenId: null, role: 'admin' })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/account-kind.spec.ts"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`apps/api/src/auth/account-kind.ts`:
```ts
/** 账号双类型判定（纯派生，不依赖任何新增列）。
 * 内部 = 飞书 SSO 账号（有 larkOpenId）∪ 超级管理员（emergency_admin，本地 bootstrap）。
 * 外部 = 其余（管理员创建的本地账号）。 */
export interface AccountKindInput {
  larkOpenId: string | null;
  role: string;
}
export function isInternal(u: AccountKindInput): boolean {
  return u.larkOpenId != null || u.role === 'emergency_admin';
}
export function isExternal(u: AccountKindInput): boolean {
  return !isInternal(u);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/account-kind.spec.ts"`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/auth/account-kind.ts apps/api/test/account-kind.spec.ts
git commit -m "feat(api): account-kind 内部/外部判定工具 + 单测"
```

---

## Task 3: 飞书登录写入 `mobile`

**Files:** Modify `apps/api/src/auth/lark/lark.controller.ts`(create + update 两处 data)。

- [ ] **Step 1: 改两处 data**

`info.mobile` 已在 `LarkUserInfo`（`lark.service.ts:27`）。在 update（约 `lark.controller.ts:117-124`)与 create（约 `:128-138`）的 `data` 里,`email` 同级加:
```ts
          email: info.email ?? null,
          mobile: info.mobile ?? null,
          avatarUrl: info.avatar_url,
```
两处都加 `mobile: info.mobile ?? null,`。

- [ ] **Step 2: typecheck**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck"`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/auth/lark/lark.controller.ts
git commit -m "feat(api): 飞书登录同步写入 mobile"
```

---

## Task 4: 外部建号分配 `externalCode`（W+8位，事务 max+1）+ 强制 user

**Files:** Modify `apps/api/src/users/users.service.ts`(`createLocal`);Modify `apps/api/src/users/users.controller.ts`(role 入参);Test `apps/api/test/users-create.e2e.spec.ts`。

- [ ] **Step 1: 补 e2e（递增 + 强制 user）**

在 `apps/api/test/users-create.e2e.spec.ts` 新增用例（沿用该文件已有的 admin 登录 + CSRF helper；若 helper 名不同,按文件现状调用）:
```ts
it('外部建号分配递增 externalCode 且强制 role=user', async () => {
  const a = await createLocalUser({ localUsername: 'ext_a', name: 'A' });
  const b = await createLocalUser({ localUsername: 'ext_b', name: 'B' });
  // externalCode 形如 W0000000N，b 比 a 大 1
  expect(a.user.externalCode).toMatch(/^W\d{8}$/);
  expect(b.user.externalCode).toMatch(/^W\d{8}$/);
  const na = Number(a.user.externalCode.slice(1));
  const nb = Number(b.user.externalCode.slice(1));
  expect(nb).toBe(na + 1);
  // 即使请求体带 role:'admin' 也落为 user
  const c = await createLocalUser({ localUsername: 'ext_c', name: 'C', role: 'admin' });
  expect(c.user.role).toBe('user');
});
```
（`createLocalUser` 为该文件中已有的 POST `/users` helper;若无,内联用 supertest 带 admin cookie + `X-CSRF-Token` 发 `POST /users`,参考同文件既有用例。)

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/users-create.e2e.spec.ts"`
Expected: FAIL（externalCode 为 undefined；role 仍是 admin）。

- [ ] **Step 3: 改 `createLocal`**

`apps/api/src/users/users.service.ts` 把 `createLocal`(约 178-210)改为:① 入参 role 收敛为 `'user'`(本地账号=外部,恒普通用户);② 事务内分配 externalCode:
```ts
  async createLocal(input: { localUsername: string; name: string; email?: string }) {
    const exists = await this.prisma.user.findUnique({
      where: { localUsername: input.localUsername },
      select: { id: true },
    });
    if (exists) throw new ConflictException('username_taken');
    const plaintext = randomBytes(9).toString('base64url');
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // 取现有 externalCode 最大序号 + 1（行锁防并发撞号）
        const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
          SELECT MAX(CAST(SUBSTRING(external_code FROM 2) AS INTEGER)) AS max
          FROM users WHERE external_code LIKE 'W%' FOR UPDATE`;
        const next = (rows[0]?.max ?? 0) + 1;
        const externalCode = `W${String(next).padStart(8, '0')}`;
        return tx.user.create({
          data: {
            localUsername: input.localUsername,
            name: input.name,
            email: input.email ?? null,
            role: 'user',
            externalCode,
            localPasswordHash: await bcrypt.hash(plaintext, 12),
            mustChangePassword: true,
          },
          select: {
            id: true, localUsername: true, name: true, role: true,
            email: true, externalCode: true,
          },
        });
      });
      return { plaintext, user };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('username_taken');
      }
      throw e;
    }
  }
```
> 说明:`FOR UPDATE` 在 `SELECT MAX(...)` 上对匹配行加锁,低并发建号下足以串行化分配;`external_code` `@unique` 兜底。`bcrypt.hash` 在事务内对单账号建号(低频)可接受。

- [ ] **Step 4: 改 controller role 入参**

`apps/api/src/users/users.controller.ts` 建号端点:不再向 `createLocal` 传 role(或调用处删去 role 透传);若 DTO 仍含 role 字段,保留校验但调用 `createLocal` 时不传(本地账号恒 user)。确保调用为 `this.users.createLocal({ localUsername, name, email })`。

- [ ] **Step 5: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/users-create.e2e.spec.ts"`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/users/users.service.ts apps/api/src/users/users.controller.ts apps/api/test/users-create.e2e.spec.ts
git commit -m "feat(api): 外部建号分配 W+8位 externalCode（事务 max+1）+ 本地账号恒 user"
```

---

## Task 5: `MeResponse` 增字段 + 删解绑 + setPassword 仅改密 + updateProfile 内部只读

**Files:** Modify `apps/api/src/auth/controllers/me.controller.ts`。

- [ ] **Step 1: `MeResponse` 增字段 + 取数**

`me.controller.ts` 的 `MeResponse`(约 31-38)在 `larkUserId` 后加:
```ts
  larkUserId: string | null;
  mobile: string | null;
  externalCode: string | null;
  isInternal: boolean;
  hasLocalPassword: boolean;
```
在构造 me 响应处(约 72-79),补:
```ts
        larkUserId: user.larkUserId,
        mobile: user.mobile,
        externalCode: user.externalCode,
        isInternal: isInternal(user),
        hasLocalPassword: Boolean(user.localPasswordHash),
```
文件顶部 import:
```ts
import { isInternal } from '../account-kind.js';
```
（`user` 由 `prisma.user.findUnique` 取得,已含全列;若该处用了 `select`,补 `mobile/externalCode/larkOpenId/role`。)

- [ ] **Step 2: `setPassword` 改为仅改密**

把 `setPassword`(约 110-142)首设分支删除,始终要求当前密码:
```ts
  @Patch('me/password')
  async setPassword(@CurrentUser() jwt: JwtClaims, @Body() rawBody: unknown, @Req() req: Request) {
    const dto = SetPasswordDtoSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { id: jwt.sub } });
    if (!user) throw new UnauthorizedException();
    if (!user.localPasswordHash) throw new BadRequestException('no_local_password');
    if (!dto.currentPassword) throw new BadRequestException('current_password_required');
    const ok = await bcrypt.compare(dto.currentPassword, user.localPasswordHash);
    if (!ok) throw new BadRequestException('current_password_incorrect');
    const hash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: jwt.sub },
      data: { localPasswordHash: hash, mustChangePassword: false },
    });
    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: 'user.password.change',
      resourceType: 'user',
      resourceId: user.id,
      request: req,
    });
    return { ok: true };
  }
```
（移除了 `wasSet`、`local_username_required`、`user.password.set` 分支;SSO 用户无 localPasswordHash → `no_local_password`,前端不会暴露此入口。)

- [ ] **Step 3: `updateProfile` 内部账号 name 只读**

`updateProfile`(约 88-107)在写入前加内部判定:内部账号不允许改 `name`(随飞书同步)。把 `data.name` 赋值改为:
```ts
    const data: { name?: string; email?: string | null } = {};
    if (dto.name !== undefined) {
      if (isInternal(user)) throw new BadRequestException('internal_profile_readonly');
      data.name = dto.name;
    }
    if (dto.email !== undefined) {
      if (isInternal(user)) throw new BadRequestException('internal_profile_readonly');
      data.email = dto.email === '' ? null : dto.email;
    }
```
（内部资料只读;外部可改 name(=localUsername 的展示名)与 email。前端对内部不显示编辑入口,此处为后端兜底。）

- [ ] **Step 4: 删 `unbindLark`**

删除整个 `@Delete('me/lark-binding')` 方法(约 144-170)及其不再使用的 import(如 `Delete`)。保留 `audit` import(setPassword 仍用)。

- [ ] **Step 5: typecheck**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck"`
Expected: 通过(确认无 `Delete` 等悬空 import)。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/auth/controllers/me.controller.ts
git commit -m "feat(api): MeResponse 增 isInternal/mobile/externalCode；setPassword 仅改密；删解绑；内部资料只读"
```

---

## Task 6: 外部禁 API（签发 + guard 兜底）

**Files:** Modify `apps/api/src/auth/api-token/api-token.controller.ts`、`api-token.service.ts`、`guards/api-auth.guard.ts`;Test `apps/api/test/uploads.e2e.spec.ts` 同目录新建 `api-token-internal-only.e2e.spec.ts`。

- [ ] **Step 1: 写 e2e**

`apps/api/test/api-token-internal-only.e2e.spec.ts`(沿用现有 e2e 启动/登录 helper;外部账号 = 用 admin 建一个本地账号再以其登录):
```ts
// 1) 外部账号 POST /users/me/api-tokens → 403 external_account_forbidden
// 2) 超级管理员(内部)POST /users/me/api-tokens → 200 返回 plaintext
```
（断言 403 与 200;具体登录/cookie 写法照搬同目录既有 e2e。）

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/api-token-internal-only.e2e.spec.ts"`
Expected: FAIL（外部当前能签发 → 得到 200 而非 403）。

- [ ] **Step 3: 签发端点加内部判定**

`api-token.controller.ts` 的 `create`(约 48-）:取当前用户的 `larkOpenId/role` 判定内部,外部 403。注入 prisma(若未注入)或经 `UserStateService`。最小实现:
```ts
const u = await this.prisma.user.findUnique({
  where: { id: me.sub }, select: { larkOpenId: true, role: true },
});
if (!u || isExternal(u)) throw new ForbiddenException('external_account_forbidden');
```
import `isExternal` from `../account-kind.js`、`ForbiddenException` from `@nestjs/common`、`PrismaClient`。

- [ ] **Step 4: guard 兜底**

`api-token.service.ts` 的 `verify`(约 88-109)把 select 加 `larkOpenId`,返回值加 `larkOpenId`:
```ts
include: { user: { select: { id: true, role: true, disabledAt: true, larkOpenId: true } } },
...
return { id: row.user.id, role: row.user.role, larkOpenId: row.user.larkOpenId };
```
对应接口 `ApiTokenAuthUser`(约 27-30)加 `larkOpenId: string | null;`。
`api-auth.guard.ts` Path 1(约 47-58)在 `verify` 成功后:
```ts
if (isExternal(user)) throw new ForbiddenException('external_account_forbidden');
```
import `isExternal` from `../account-kind.js`（`ForbiddenException` 已 import）。

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run:
```
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/api-token-internal-only.e2e.spec.ts && pnpm run typecheck"
```
Expected: PASS + typecheck 通过。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/auth/api-token apps/api/src/auth/guards/api-auth.guard.ts apps/api/test/api-token-internal-only.e2e.spec.ts
git commit -m "feat(api): 外部账号禁用 API（签发 403 + ApiAuthGuard 兜底）"
```

---

## Task 7: changeRole→admin 仅内部 + 锁定 public 仅 admin

**Files:** Modify `apps/api/src/users/users.service.ts`(`changeRole`);Test `apps/api/test/users-role-safety.e2e.spec.ts`、`apps/api/test/template-sharing.e2e.spec.ts`。

- [ ] **Step 1: 写 e2e（changeRole）**

在 `apps/api/test/users-role-safety.e2e.spec.ts` 加:
```ts
it('外部账号不能被提升为 admin', async () => {
  const ext = await createLocalUser({ localUsername: 'ext_role', name: 'X' }); // 外部
  // admin 调 PATCH /users/:id/role { role:'admin' } → 403 external_cannot_be_admin
  const res = await patchRole(ext.user.id, 'admin');
  expect(res.status).toBe(403);
  expect(res.body.message).toContain('external_cannot_be_admin');
});
```
（`createLocalUser`/`patchRole` 用该文件或 users-create 既有 helper。）

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/users-role-safety.e2e.spec.ts"`
Expected: FAIL（当前外部可被提升 → 非 403）。

- [ ] **Step 3: 改 `changeRole`**

`users.service.ts` `changeRole`(115-136)在取 target 时补 `larkOpenId`,并在设 admin 时校验内部:
```ts
  async changeRole(meId: string, targetId: string, role: 'user' | 'admin') {
    if (targetId === meId) throw new ForbiddenException('cannot_modify_self');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, larkOpenId: true },
    });
    if (!target) throw new ForbiddenException('user_not_found');
    if (target.role === 'emergency_admin')
      throw new ForbiddenException('emergency_admin_protected');
    if (role === 'admin' && isExternal(target))
      throw new ForbiddenException('external_cannot_be_admin');
    if (target.role === role) return { id: targetId, role };
    // ...(其余事务/last_admin 逻辑不变)
```
import `isExternal` from `../auth/account-kind.js`（按 users.service 相对路径调整)。

- [ ] **Step 4: 写/确认 e2e（public 仅 admin）**

在 `apps/api/test/template-sharing.e2e.spec.ts` 确认/补一条:外部账号(非 admin)调 `PATCH /templates/:id/visibility {visibility:'public'}` → 403/Forbidden(被 `@Roles` 挡)。同时核实 `POST /templates`(create)/`PATCH /templates/:id`(update)请求体即便带 `visibility:'public'` 也**不会**落库为 public —— 若 `templates.service` 的 create/update 透传了 visibility,则在 service 层忽略 visibility 字段(可见性只经 `setVisibility`)。补断言:create 带 `visibility:'public'` 后该模板 `listPublic` 不含它。

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run:
```
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec vitest run test/users-role-safety.e2e.spec.ts test/template-sharing.e2e.spec.ts && pnpm run typecheck"
```
Expected: PASS + 通过。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/users/users.service.ts apps/api/src/templates apps/api/test/users-role-safety.e2e.spec.ts apps/api/test/template-sharing.e2e.spec.ts
git commit -m "feat(api): 仅内部账号可授权 admin；锁定公共可见性仅经 admin setVisibility"
```

---

## Task 8: 前端个人中心按类型展示 + 删解绑 + 密码区

**Files:** Modify `apps/web/src/views/MeView.vue`;Modify 鉴权 store / `MeResponse` 前端类型(增 `isInternal/mobile/externalCode`)。

- [ ] **Step 1: 前端类型增字段**

找到 `MeResponse`/当前用户类型定义处(`auth` store 或 `lib/api` 类型),加:
```ts
  mobile: string | null;
  externalCode: string | null;
  isInternal: boolean;
```

- [ ] **Step 2: MeView 按类型渲染**

`MeView.vue`:
- 用户名:`isInternal` → 显示 `name`、只读;否则显示 `localUsername`、可编辑。
- 手机号行:仅 `isInternal` 显示 `mobile`(只读)。
- 邮箱:`isInternal` 只读显示 `email`;否则可编辑。
- 唯一ID 行:`isInternal` 显示 `larkUserId`(无则回退 localUsername);否则显示 `externalCode`。
- 删除「解绑飞书」按钮 + `unbindDialogOpen`/`unbinding`/`unbindLark`/弹窗(约 140-161、325-352)。
- 密码区:保留,显示条件改为 `hasLocalPassword`(SSO 内部用户无密码 → 不显示)。按钮文案固定「修改密码」(去掉"设置密码"分支),提交始终带 `currentPassword`。

- [ ] **Step 3: typecheck + lint**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`
Expected: 通过(确认无 unbind 悬空引用)。

- [ ] **Step 4: 手测**

内部账号:用户名/手机/邮箱只读、显示工号、无密码区、无解绑;外部账号:用户名/邮箱可编辑、显示 W 编号、有「修改密码」。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/views/MeView.vue apps/web/src/stores apps/web/src/lib
git commit -m "feat(web): 个人中心按内部/外部分型展示；移除解绑飞书；密码区按 hasLocalPassword"
```

---

## Task 9: 用户管理角色更名 + 下拉规则 + 内部/外部标签

**Files:** Modify `apps/web/src/views/admin/UsersAdminView.vue`、`apps/web/src/views/admin/AuditLogView.vue`。

- [ ] **Step 1: 角色文案更名**

`UsersAdminView.vue`:角色选项/标签 `emergency_admin` 的 `label` `'应急管理员'` → `'超级管理员'`(约 60 行);`emergency_admin_protected` 提示文案 `'应急管理员受保护'` → `'超级管理员受保护'`(约 140 行)。`AuditLogView.vue` 中所有"应急管理员"文案 → "超级管理员"。

- [ ] **Step 2: 角色下拉规则**

改角色的下拉/操作(`doChangeRole`,约 176)只提供 `普通用户 / 管理员` 两项;且当目标为**外部账号**(由列表项派生 `accountType==='external'` 或 `larkUserId==null && role!=='emergency_admin'`)时,禁用「管理员」选项并加 tooltip「仅内部账号可授权管理员」;超级管理员行的角色为只读展示(不渲染可改下拉)。捕获后端 `external_cannot_be_admin` → `ElMessage.error('仅内部账号可授权管理员')`。

- [ ] **Step 3: 内部/外部标签**

列表"账号类型"展示改为内部/外部:`accountType` 取自后端(见 T7 列表派生)或前端按 `larkUserId!=null || role==='emergency_admin'` 判定。标签:内部=「内部」,外部=「外部」。`accountId`(约 155)内部用 `larkUserId`、外部用 `externalCode`(需后端列表返回 externalCode;若未返回,在 T7 列表 select 补 `externalCode` 并加入响应)。

- [ ] **Step 4: typecheck + lint**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"`
Expected: 通过。

- [ ] **Step 5: 手测**

后台:角色显示「超级管理员/管理员/普通用户」;外部账号「管理员」禁用且提示;列表显示内部/外部 + 对应唯一ID。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/views/admin/UsersAdminView.vue apps/web/src/views/admin/AuditLogView.vue
git commit -m "feat(web): 角色更名超级管理员 + 外部禁选管理员 + 内部/外部标签"
```

> 注:T9 Step 3 依赖列表接口返回 `externalCode` 与派生类型。若 T7 未覆盖,在 `users.service` 列表(约 51-110)的 `select` 加 `externalCode`、`larkOpenId`,响应项加 `externalCode` 与 `accountType: isInternal(u) ? 'internal' : 'external'`,并更新前端 `UserItem` 类型(`accountType` 增 `'internal'|'external'`)。同任务一并提交。

---

## Task 10: 文档同步

**Files:** Modify `docs/PROGRESS.md`、`docs/qa/template-module-verification-checklist.md`、spec 状态行。

- [ ] **Step 1: PROGRESS 近期变更**

`docs/PROGRESS.md` `### 2026-05-27` 顶部追加:
```markdown
- **feat：账号内部/外部双类型 + 身份展示 + 权限强制** —— 账号收敛为两类(飞书SSO=内部 / 本地=外部,初始账号=内部超管);派生 `isInternal`(无新增分类列);User 加 `mobile`(飞书同步)、`externalCode`(外部 `W+8位` 递增)。个人中心按类型展示(内部只读 / 外部用户名·邮箱可编辑);外部禁 API 签发(+guard 兜底)、禁授权 admin;公共可见性仍仅 admin。"应急管理员"更名"超级管理员"(仅展示、不可经 UI 分配)。移除会死锁的「解绑飞书」,`setPassword` 改为仅改密。
```

- [ ] **Step 2: qa checklist + 已知问题表**

`docs/qa/template-module-verification-checklist.md`:删/改「解绑飞书」「未设密码用户点解绑」相关行(约 41、83);`docs/PROGRESS.md` §4 把「飞书未设密码用户解绑 🟡 未测」改为 `~~...~~ | ✅ 已解决 | 账号双类型重构后解绑流程移除,死锁消除`。spec 顶部状态行保持「已确认」。

- [ ] **Step 3: 提交**

```bash
git add docs/PROGRESS.md docs/qa/template-module-verification-checklist.md
git commit -m "docs: 同步账号内部/外部双类型 + 移除解绑死锁项"
```

---

## Self-Review（写计划后自检）

**Spec 覆盖:**
- §1 派生分类 → T2 ✅;§2 新列 + 迁移 → T1 ✅;外部ID生成 → T4 ✅;§3 个人中心分型 + MeResponse → T5(后端)+ T8(前端)✅;mobile 同步 → T3 ✅;§4 权限(API/admin/public)→ T6、T7 ✅;§5 角色更名 + 下拉规则 → T9 ✅;§6 删解绑 + setPassword 仅改密 → T5 ✅;测试 → T2/T4/T6/T7 e2e ✅;文档 → T10 ✅。
- 无遗漏 spec 要求。

**占位符扫描:** 无 TBD/TODO;e2e helper 处标注"沿用既有 helper"是因各 e2e 文件已有登录/CSRF 工具,属对现有约定的引用而非占位;关键逻辑(account-kind、externalCode 分配、guard、changeRole、setPassword)均给出完整代码。

**类型一致性:** `isInternal/isExternal(AccountKindInput{larkOpenId,role})` 全任务统一;`MeResponse` 增 `mobile/externalCode/isInternal` 在 T5(后端)与 T8(前端类型)一致;`ApiTokenAuthUser` 增 `larkOpenId` 与 `verify` 返回一致(T6);列表 `accountType` 由 `'lark'|'local'|'both'` 调整为含 `'internal'|'external'`,前后端在 T7/T9 同步(注:实现时若沿用旧三值,需在 T9 注里改为 internal/external 二值,保持单一口径)。

**迁移安全:** T1 仅 ALTER ADD COLUMN 可空 + 唯一索引,无 reset/数据丢失;create-only 审核后 deploy。
