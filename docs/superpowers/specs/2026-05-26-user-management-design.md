# 用户管理（CRUD + 禁用 + 角色 + 本地账号登录打通）· 设计

**日期**：2026-05-26
**Spec author**：Claude Code
**范围**：apps/api（新增 users 模块 + auth 改造 + Prisma 迁移）+ apps/web（admin 用户管理页）
**前置状态**：项目尚未上线，仍在开发机（可加 migration 清理历史开发数据）

---

## 1. 背景

侧边栏「用户管理」(`/admin/users`) 当前是占位页，且无后端 `apps/api/src/users` 模块——管理员无法新建本地账号 / 改角色 / 重置密码 / 启用禁用。本迭代把它做成真实能力。

实现前发现 3 个必须一起处理的既有约束（否则功能不自洽）：

- **本地登录被写死只认 emergency_admin**：`apps/api/src/auth/local/local.controller.ts:55` 要求 `role === 'emergency_admin'`，且 `:66` 用固定 `role:'emergency_admin'` 签 JWT。→ 管理员新建的普通本地账号根本登录不了。
- **鉴权不查 DB**：`JwtAuthGuard` 只 `jwt.verify(token)`（`jwt-auth.guard.ts:33`），access token 默认 24h（`common/env.ts`）。→ 禁用/降级在 token 过期前不生效。
- **飞书身份与本地用户名耦合**：飞书 SSO 建号时写 `localUsername = info.user_id`（`lark.controller.ts:127`），`localUsername` 又是 unique。→ 管理员建本地账号可能与未来飞书 user_id 撞名；"类型 lark/local" 也无法只看 localUsername 判断。

---

## 2. 决策汇总（已与用户确认）

| # | 决策 | 取值 |
|---|------|------|
| D1 | 管理对象范围 | 所有用户（飞书+本地）；改角色/启用禁用对全体生效；重置密码、新建仅本地账号 |
| D2 | 禁用即时性 | 异步守卫 + UserStateService 缓存；禁用/改角色**主动 evict 缓存** → **下一请求即生效**（TTL 仅兜底）；并吊销 refresh + API token |
| D3 | 安全规则（事务内） | 不能禁用/降级自己；emergency_admin 不可被他人操作；不能降级/禁用最后一个活跃 `role==='admin'`（**不含 emergency_admin**）；改角色仅 `user ↔ admin` |
| D4 | 新建本地账号初始密码 | 系统生成一次性随机密码（弹框显示一次）+ `mustChangePassword=true` |
| D5 | 本地登录打通 | 任意**未禁用**、有 `localPasswordHash` 的用户均可本地登录；JWT 按**真实 role** 签发 |
| D6 | 飞书/本地解耦 | 飞书 SSO 不再写 `localUsername`；`localUsername` 仅用于本地密码登录账号；类型按 `larkOpenId` + `localPasswordHash` 判断 |
| D7 | 审计命名 | dot 风格：`user.create` / `user.role.change` / `user.password.reset` / `user.disable` / `user.enable` |

---

## 3. 详细设计

### 3.1 数据模型 + 迁移

```prisma
model User {
  // …沿用…
  disabledAt DateTime? @map("disabled_at")  // null = 活跃
}
```

迁移名：`decouple_lark_local_username_and_disable_users`。包含：
1. `ALTER TABLE users ADD COLUMN disabled_at TIMESTAMP(3)`（可空）。
2. **仅开发数据清理**（条件严格，绝不动有本地密码的用户）：
   ```sql
   UPDATE users SET local_username = NULL
   WHERE local_password_hash IS NULL AND lark_open_id IS NOT NULL;
   ```
   纯增量 schema + 一条受限 UPDATE；不违反 CLAUDE.md（无 reset / 无 data-loss）。

### 3.2 UserStateService（新，auth 模块内）

进程内 TTL 缓存，键 `userId`，值 `{ role: string; disabledAt: Date | null } | null`：
- `get(userId)`：命中返回缓存；未命中查 DB（`select id, role, disabledAt`）；**DB 查不到用户 → 返回 `null`**（调用方据此 401）。
- 正例缓存 TTL **10s**（兜底，防遗漏失效）；可缓存"不存在"短哨兵避免击穿，但以正确性优先——失效永远以**主动 evict** 为准。
- `evict(userId)`：删除该用户缓存。
- 抽象成接口（`UserStateStore`），当前实现为进程内 `Map`+时间戳；多实例部署时可换 Redis（已在技术栈），不改调用方。
- **模块装配**：`UserStateService` 由 `AuthModule` `providers` 提供并**加入 `exports`**（当前只 export `JwtAuthService/RefreshTokenService/ApiTokenService`，见 `auth.module.ts:108`）；`UsersModule` `imports: [AuthModule]` 以调用 `evict()` 与 `revokeAllForUser()`。（AuthModule 内的 APP_GUARD 守卫直接注入即可。）

> **"及时生效"定义**：禁用 / 改角色时**主动 `evict(userId)`**，因此**同进程下一请求即生效**（不是等 TTL）。TTL 只是兜底窗口，不是预期延迟。

### 3.3 鉴权改造

- **`JwtAuthGuard` → async `canActivate(): Promise<boolean>`**：
  1. 先 `jwt.verify(token)`（验签 + 取 claims）；
  2. `const state = await userState.get(claims.sub)`；
  3. `state === null`（用户不存在）或 `state.disabledAt != null` → 抛 401，并不设置 `req.user`；
  4. 否则 `req.user = { ...claims, role: state.role }`（**用 DB 最新 role 覆盖 JWT role**）。
- **`ApiAuthGuard`**：
  - **cookie 路径**复用同一套 UserStateService 校验（与 JwtAuthGuard 一致，避免两套逻辑漂移）；
  - **Bearer 路径**：`ApiTokenService.verify()` 增加 `select user.disabledAt`，owner 被禁用 → 返回 `null`（拒绝）。
- **本地登录**（`local.controller`）：去掉 `role==='emergency_admin'` 限制，改为"有 `localPasswordHash` 且 `disabledAt==null`"；用 `user.role` 真实签发；禁用用户拒绝（`account_disabled`）。
- **飞书登录**（`lark.controller`）：建号时**删除** `localUsername: info.user_id`；登录/refresh 校验 `disabledAt`。
- **`/users/me/password`**（`me.controller`）：**保留**已有 `localUsername` 的改密流程（emergency_admin / 本地账号不受影响）；当用户**无** `localUsername` 时**不再** silent fallback 到 `larkUserId`，返回明确错误 `local_username_required`（飞书用户启用本地登录的完整流程本迭代 out-of-scope）。
- **吊销**：`RefreshTokenService` 已有 `revokeAllForUser()`；`ApiTokenService` 新增 `revokeAllForUser()`。禁用时两者都调 + `userState.evict`。改角色时仅 `userState.evict`（不吊销 token，role 覆盖即生效）。

### 3.4 users 模块（`apps/api/src/users/`，admin 守卫 = `admin` | `emergency_admin`）

Controller 只做 DTO（zod）校验 + 调 service；service 调 Prisma（遵守分层）。

- **`GET /admin/users`** query：`page`(默认1) / `pageSize`(默认20, ≤100) / `search`(name/localUsername/email) / `role`(user|admin|emergency_admin) / `status`(active|disabled) / `type`(lark|local|both)。
  `search` 覆盖 `name / localUsername / email / larkUserId`（账号列会显示飞书标识，故搜索需含 larkUserId）。
  响应：`{ items, total, page, pageSize }`（与审计页 / `BrandPagination` 对齐）。
  item：
  ```ts
  {
    id, name, email,
    role,                       // user | admin | emergency_admin
    localUsername,              // string | null
    larkUserId,                 // string | null
    hasLocalPassword,           // localPasswordHash != null
    hasLarkBinding,             // larkOpenId != null
    accountType,                // 'lark' | 'local' | 'both'（后端按 has* 推导）
    accountLabel,               // 展示串：飞书 / 本地 / 飞书+本地（后端算好）
    disabled,                   // disabledAt != null
    // 每行操作可用性 —— 后端按 §3.5 同一套规则算好（服务端分页下前端无法可靠判断"最后一个 admin"等全局条件）
    can: {
      disable: boolean,         // 自己 / emergency_admin / 最后一个活跃 admin → false
      changeRole: boolean,
      resetPassword: boolean,   // 仅 hasLocalPassword 且非 emergency_admin
    },
    disabledReason,             // string | null（按钮置灰时的悬浮说明，如 last_admin_protected）
    lastLoginAt, createdAt
  }
  ```
  > 前端仅据 `can.*` 置灰；**后端在各 mutation 接口仍权威校验**（前端能力位只是 UX，不可信）。
- **`POST /admin/users`** body `{ localUsername, name, role: 'user'|'admin', email? }` → 系统随机一次性密码 + `mustChangePassword=true`，返回 `{ plaintext, user }`；`localUsername` 撞 unique → **409**。
- **`PATCH /admin/users/:id/role`** body `{ role: 'user'|'admin' }`。
- **`POST /admin/users/:id/reset-password`**（**仅本地账号**，即 `hasLocalPassword`；否则 400）→ 新随机一次性密码 + `mustChangePassword=true`。
- **`POST /admin/users/:id/disable`** / **`/enable`**：置/清 `disabledAt`；disable 额外 `revokeAllForUser`（refresh+api）+ `userState.evict`。

### 3.5 安全规则（service 层权威校验，**事务内** count+update）

- **不能操作自己**：`:id === me.sub` 的 disable / role-降级 → 拒绝（`cannot_modify_self`）。
- **emergency_admin 不可被动**：目标 `role==='emergency_admin'` 的 disable / role / reset → 拒绝（`emergency_admin_protected`）。
- **保留最后一个活跃 admin**：disable 或把 `admin`→`user` 前，必须**并发安全**地校验 `count(role==='admin' AND disabledAt IS NULL)`（**不计 emergency_admin**），归零则拒绝（`last_admin_protected`）。
  - ⚠️ 仅"事务内 count 再 update"在 PostgreSQL 默认 **Read Committed** 下不够：两个并发降级/禁用可能都 count 到 2 再各自 update → 归零。**必须用以下之一**：
    1. `$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` + 捕获序列化失败（PG `40001` / Prisma `P2034`）→ 返回冲突重试错误；**或**
    2. 事务内对候选 admin 行加行锁（`SELECT id FROM users WHERE role='admin' AND disabled_at IS NULL FOR UPDATE` via `$queryRaw`）后再 count+update；**或**
    3. 条件式原子更新（`UPDATE ... WHERE ... AND (SELECT count(*) ...) > 1`，受影响行数=0 视为被保护）。
  - 计划阶段从中选定一种并在测试里跑**真并发**用例（两请求同时降级/禁用最后两个 admin，断言最终仍 ≥1 活跃 admin）。
- 改角色枚举仅 `user|admin`（DTO 层就拒绝 `emergency_admin`）。

### 3.6 前端（真实 `UsersAdminView.vue`）

- 列：名称 / 账号（`accountLabel` + `localUsername`或飞书标识）/ 角色徽章 / 类型 / 状态（活跃·已禁用）/ 最近登录。
- 行操作：改角色下拉、重置密码、禁用/启用 —— 按响应里每行 `can.*` 置灰，`disabledReason` 作悬浮说明（不在前端重算全局规则）。
- 顶部「新建本地账号」→ dialog（localUsername/name/role/email?）→ 成功后一次性明文密码 dialog（复用 ApiToken 一次性明文组件模式）。
- 服务端分页复用 `BrandPagination`；搜索/过滤栏；破坏性操作走 `ConfirmDialog`。
- 强制改密：复用 `MustChangePasswordDialog` + `/me/password`，文案去 emergency-admin 化，改为通用「初始/临时密码」。

### 3.7 审计（沿用 iter32 AuditLog，dot 命名）

`user.create` / `user.role.change` / `user.password.reset` / `user.disable` / `user.enable`，actor=操作管理员，resourceId=目标用户。

---

## 4. 非目标（YAGNI）

不做：硬删除（用户拥有模板 → 用禁用替代）；批量操作；邀请邮件；**飞书用户自助设置本地登录名+密码的完整流程**（本迭代仅停止 larkUserId 自动写入，需要时单独迭代）。

---

## 5. 测试要点

- 本地**普通**账号（admin 新建、role=user/admin）能登录，JWT 带真实 role。
- 禁用后：**下一请求**（非等 TTL）登录 / refresh / 受保护接口 / Bearer API token **全部拒绝**。
- 角色 `admin→user` 后：**下一请求** admin 接口即 403（缓存已 evict + role 覆盖）。
- 安全：不能禁用/降级自己；不能操作 emergency_admin；不能降级/禁用最后一个活跃 admin。**并发用例**：两请求同时降级/禁用仅剩的两个 admin，断言最终仍 ≥1 活跃 admin（验证 §3.5 选定的并发安全方案，非伪保证）。
- 列表 `can.*` 能力位与后端权威校验一致（前端置灰处后端也拒绝）。
- 新建本地账号 localUsername 撞名 → 409。
- UserStateService：用户不存在 → 401。
- 飞书新建用户 `localUsername` 为 null；`hasLocalPassword=false` 的飞书用户调 `/me/password` → `local_username_required`；已有 localUsername 的 emergency_admin 改密正常。

---

## 6. 文档同步

- `docs/PROGRESS.md`：第 3 节近期变更 + 顶部日期；第 2 节"已交付能力"补用户管理。
- `AGENTS.md`：第 2 节目录结构补 `apps/api/src/users/`；若鉴权流程描述涉及，按第 9 节触发映射同步。

---

## 7. 受影响文件（预估）

- `apps/api/prisma/schema.prisma`（+migration）
- 新增 `apps/api/src/users/users.{module,controller,service}.ts`
- `apps/api/src/auth/`：新增 `user-state.service.ts`；改 `guards/jwt-auth.guard.ts`、`guards/api-auth.guard.ts`、`local/local.controller.ts`、`lark/lark.controller.ts`、`controllers/me.controller.ts`、`api-token/api-token.service.ts`、（`refresh-token.service.ts` 已有 revokeAllForUser）
- `apps/web/src/views/admin/UsersAdminView.vue`（占位 → 真实）、`components/MustChangePasswordDialog.vue`（文案）、可能复用 `BrandPagination` / `ConfirmDialog`
- `docs/PROGRESS.md`、`AGENTS.md`
