# Plan: iter 29 — 渲染日志 + API Token 管理

> 对应 spec：[2026-05-24-iter-29-render-log-api-token-design.md](../specs/2026-05-24-iter-29-render-log-api-token-design.md)  
> 分支：`feature/iter-29-render-log-api-token`  
> 状态：待执行  
> 预计 commit：8 个

## 任务依赖

```
T1 (DB api_tokens)
  └─▶ T2 (ApiToken service + crypto)
        └─▶ T3 (/users/me/api-tokens CRUD endpoints)
              └─▶ T4 (ApiAuthGuard + render 端点切换)
                    └─▶ T8 (验证)

T5 (Web: /me/api-tokens 视图)  ← 可与 T3/T4 并行

T6 (Backend: GET /api/render/jobs)
  └─▶ T7 (Web: /logs 视图)
        └─▶ T8

T8 (PROGRESS + 端到端 + CI)
```

每个 task 单独 commit。

---

## T1 · DB：`api_tokens` 表 + migration

### Schema

```prisma
model ApiToken {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  name        String                                 // "demo-bot" etc.
  tokenHash   String    @unique @map("token_hash")   // SHA-256 hex
  prefix      String                                 // 'tpkn_a1b2c3d4'（前 8 字符，列表展示）

  lastUsedAt  DateTime? @map("last_used_at")
  revokedAt   DateTime? @map("revoked_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([userId, revokedAt])
  @@map("api_tokens")
}
```

User model 新增反向 `apiTokens ApiToken[]`。

### Migration

```
pnpm --filter @template-printing/api db:migrate:dev --name add_api_tokens
```

### 验收

- [ ] migration 生成 + 应用
- [ ] `\d api_tokens` 含所有字段 + unique on tokenHash
- [ ] typecheck 通过

### Commit

```
feat(db): api_tokens 表 — 用户级 Bearer token 鉴权
```

---

## T2 · `ApiTokenService` — 生成 / 校验 / 列表

### 文件

**新建 `apps/api/src/auth/api-token/api-token.service.ts`**

### 接口

```ts
@Injectable()
export class ApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为指定用户创建一个 token；返回明文（仅这一次）+ 入库记录。
   */
  async create(userId: string, name: string): Promise<{
    plaintext: string;
    record: { id: string; name: string; prefix: string; createdAt: Date };
  }>;

  /**
   * 列出某用户的所有 token（按 revokedAt asc / createdAt desc）。
   * 不含 hash 或明文。
   */
  async listByUser(userId: string): Promise<ApiTokenSummary[]>;

  /**
   * 验证一个明文 token，返回关联用户（含 role），或 null 表示无效 / 已吊销。
   * 同时更新 lastUsedAt（fire-and-forget）。
   */
  async verify(plaintext: string): Promise<{ id: string; role: string } | null>;

  /**
   * 软删（设 revokedAt）。检查 userId 拥有该 token。
   */
  async revoke(userId: string, tokenId: string): Promise<void>;
}
```

### crypto helpers

```ts
const TOKEN_PREFIX = 'tpkn_';
function generatePlaintext(): string {
  const random = crypto.randomBytes(16).toString('hex'); // 32 hex
  return TOKEN_PREFIX + random;
}
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function prefixFor(plaintext: string): string {
  return plaintext.slice(0, TOKEN_PREFIX.length + 8); // tpkn_a1b2c3d4
}
```

### 单测

**新建 `apps/api/test/api-token-service.spec.ts`**

- create 返回 plaintext 形如 `tpkn_<32 hex>`，record 不含 plaintext
- verify 成功路径：合法 token 返回 user
- verify 失败路径：错 token / 已 revoke / 不存在
- verify 后 lastUsedAt 被更新（mock new Date）
- revoke 设 revokedAt + 拒绝跨用户吊销

### 验收

- [ ] 单测通过
- [ ] typecheck 通过

### Commit

```
feat(api): ApiTokenService — 生成 / 校验 / 列表 / 吊销
```

---

## T3 · `/users/me/api-tokens` CRUD endpoints

### 文件

扩展 `apps/api/src/auth/controllers/me.controller.ts`（或新建 `api-tokens.controller.ts`）。

### 端点

| 端点 | 鉴权 | 行为 |
|---|---|---|
| `GET /users/me/api-tokens` | JWT cookie | 列出当前用户的 token summary |
| `POST /users/me/api-tokens` | JWT cookie | body `{ name }` → 返回 `{ plaintext, record }` |
| `DELETE /users/me/api-tokens/:id` | JWT cookie | 软删 |

### 校验

- name length 1-64
- 同一用户允许多个 token，无 name 唯一约束（GitHub 也允许同名）

### 测试

`api-tokens.e2e.spec.ts`：

- 未登录 → 401
- 创建 → plaintext 形态正确，DB 多一行
- 列表只返回当前用户的；不含 plaintext 或 hash
- 吊销 → revokedAt set；再次列表显示 revoked
- 跨用户吊销 → 403 / 404
- 跨用户读列表 → 只看到自己的

### 验收

- [ ] e2e 通过
- [ ] typecheck 通过

### Commit

```
feat(api): /users/me/api-tokens CRUD endpoints
```

---

## T4 · `ApiAuthGuard` + `/api/render` 切换

### 文件

**新建 `apps/api/src/auth/guards/api-auth.guard.ts`**

### 实现

```ts
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: ApiTokenService,
    private readonly jwtGuard: JwtAuthGuard,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers['authorization'] as string | undefined) ?? '';

    // Path 1: Bearer tpkn_xxx
    if (auth.startsWith('Bearer tpkn_')) {
      const plaintext = auth.slice('Bearer '.length);
      const user = await this.tokens.verify(plaintext);
      if (!user) throw new UnauthorizedException('invalid_or_revoked_token');
      req.user = { sub: user.id, role: user.role };
      return true;
    }

    // Path 2: fallback to JWT cookie (含 CSRF)
    return this.jwtGuard.canActivate(ctx) as Promise<boolean>;
  }
}
```

### 应用

`render.controller.ts`：

```ts
@Controller('render')
@UseGuards(ApiAuthGuard)  // 替代 @Public 后的默认 JwtAuthGuard
export class RenderController { ... }
```

注意：`@CurrentUser()` 仍能从 `req.user` 取到 sub/role（Bearer 和 JWT 两路径都 set）。

### 测试

`api-auth-guard.spec.ts` 单元 + `render-bearer-token.e2e.spec.ts`：

- 无 Authorization + 无 cookie → 401
- Bearer 错前缀 → fallback JWT cookie 验证
- Bearer tpkn_<unknown> → 401 invalid_or_revoked_token
- Bearer tpkn_<revoked> → 401
- Bearer tpkn_<valid> → 200 + user 正确
- 无 Bearer + 合法 cookie → 200（向后兼容）

### 验收

- [ ] curl 用 Bearer token 调 `/api/render` 成功
- [ ] e2e 覆盖两条路径

### Commit

```
feat(api): ApiAuthGuard 两栈回退（Bearer → JWT cookie）+ render 端点切换
```

---

## T5 · Web：`/me/api-tokens` 视图

### 文件

- 新视图 `apps/web/src/views/ApiTokensView.vue`
- 路由加 `/me/api-tokens`
- sidebar **不显式加入口**（个人中心子页，从 `/me` 链过去）
- 或者在 sidebar 「个人中心」下放二级菜单 → 简单起见用单独菜单项 「API 凭证」

### 列表

`el-table` 列：
- 名称
- 前缀（`tpkn_a1b2c3d4…`）
- 创建时间
- 最近使用（`某某 分钟/小时/天 前` 或 "未使用"）
- 操作（吊销按钮 + ElMessageBox 二次确认）

### 创建 dialog

`el-dialog`：
- 输入名字（必填）
- [取消] [生成]
- 成功后 close 这个 → 弹另一个 **"一次性明文"** dialog（红色警告）：
  - monospace 显示明文
  - [📋 复制]
  - [我已复制] 关闭

### 验收

- [ ] 浏览器手测：创建 / 列表 / 复制 / 吊销 全流程
- [ ] 已吊销 token 在列表里灰显或标记
- [ ] 已复制 token 关闭 dialog 后无法再看明文（前端 state 不缓存）

### Commit

```
feat(web): /me/api-tokens 视图 — 列表 + 创建（一次性明文）+ 吊销
```

---

## T6 · Backend `GET /api/render/jobs` 列表端点

### 实现

`render.controller.ts` 加：

```ts
@Get('jobs')
async list(
  @CurrentUser() me: JwtClaims,
  @Query('page') page = '1',
  @Query('pageSize') pageSize = '20',
  @Query('status') status?: string,
  @Query('source') source?: string,
  @Query('templateName') templateName?: string,
): Promise<RenderJobListResp> {
  return this.svc.listJobs({ user: me, page: +page, pageSize: +pageSize, status, source, templateName });
}
```

`render.service.ts` 加 `listJobs`：

- Prisma findMany + include `template`, `larkBotSession`, `larkPrintRequest`
- 后处理：`source = 'bot' | 'bitable' | 'api'` 推断
- where 条件：
  - admin / emergency_admin → 不限 owner
  - 普通 → `template.ownerId = me.sub`
  - status / source / templateName 可选过滤
- 排序：createdAt desc
- pagination：take + skip
- count：findMany 加 prisma.$transaction 同时拿 total

### 测试

`render-jobs-list.e2e.spec.ts`：

- 普通用户只看到自己的（owner 过滤）
- admin 看全部
- status 过滤
- source 过滤（bot / bitable / api）
- templateName 模糊搜索
- 分页（page=2 pageSize=5）

### 验收

- [ ] e2e 通过
- [ ] 三种 source 都能正确推断

### Commit

```
feat(api): GET /api/render/jobs — 渲染任务列表（join + source 推断 + 分页 + 过滤 + 权限）
```

---

## T7 · Web `/logs` 视图

### 文件

- `apps/web/src/views/RenderLogsView.vue`
- 路由 `/logs` + meta `{ requiresAuth: true }`
- sidebar 加项「渲染日志」 + `History` 图标

### 列表 UI

Element Plus `el-table` + `el-tag` 状态徽标 + 来源徽标：
- 状态：pending=灰 / processing=黄 / done=绿 / failed=红
- 来源：bot=蓝 / bitable=橙 / api=紫

筛选区：
- `el-select` 状态（全部 / pending / processing / done / failed）
- `el-select` 来源（全部 / bot / bitable / api）
- `el-input` 模板名搜索（debounced 300ms）

分页：`el-pagination` 20 / 页。

### 详情 dialog

`el-dialog`：
- 顶部 grid 显示元信息（jobId / 模板 / 状态 / 来源 / 时间）
- pre 显示 data JSON
- 下载按钮（`pdfUrl` / `pngUrl` 有时才显示）
- 失败时显示 errorMsg

### 验收

- [ ] 手测分页 / 过滤 / 详情
- [ ] PDF 下载 work

### Commit

```
feat(web): /logs 视图 — 渲染日志列表 + 详情 dialog + sidebar 入口
```

---

## T8 · PROGRESS.md + 端到端验证

### 更新

`docs/PROGRESS.md`：

- 第 1 节进度表新增「渲染日志 + API Token」✅ iter 29
- 第 2 节新增 2.7 / 2.8 节
- 第 3 节追加 2026-05-24 iter 29
- 第 5 节后续计划：去掉对应已完成项

### 端到端验证

| 步骤 | 期望 |
|---|---|
| `/me/api-tokens` 创建 demo token → 复制明文 | OK |
| curl 用 Bearer token 调 `/api/render` | 200 + 渲染入队 |
| curl GET `/api/render/jobs` 用 token | 返回当前用户的任务 |
| 浏览器 `/logs` → 看到刚才的任务，来源 = "API 直调" | ✓ |
| 点详情 → 看完整 data + 下载 PDF | ✓ |
| 飞书机器人触发的任务 → 来源 = "飞书机器人" | ✓ |
| 多维表格触发的任务 → 来源 = "飞书多维表格" | ✓ |
| 普通用户 `/logs` 只看自己的 | ✓ |
| admin `/logs` 看全部 | ✓ |

### 验收

- [ ] 全部手测通过
- [ ] CI 通过
- [ ] secret 没出现在 git tracked 文件

### Commit

```
docs(progress): iter 29 渲染日志 + API Token 管理交付
```

---

## 整体验收（PR 合并前）

- [ ] T1-T8 commit 全部完成
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` 全过
- [ ] CI 通过（lint-and-test + docker-build）
- [ ] 真飞书端到端 + 真 Bearer token 端到端
- [ ] secret 没出现在 git tracked 文件

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Bearer 路径 / cookie 路径行为不一致 | bug 难定位 | guard 单元测覆盖两路径，e2e 覆盖三类组合 |
| 渲染日志权限漏接 | 普通用户看到别人的 | 后端 service 层强制 ownership 过滤；e2e 用两个不同用户验证 |
| Token 明文意外日志 / 错误信息泄露 | 安全 | service 只 log token id，不 log plaintext；error message 一律说 invalid_or_revoked_token |
| Prisma include + source 后处理 N+1 | 性能 | findMany include 一次 round-trip；分页后内存计算 source |

## 不在范围

- Token scope / 过期 / IP 白名单
- 渲染日志导出 / 保留期清理
- 「模板平台打印」记录入日志
- 重新生成 token（rotate） — v1 用"吊销旧的 + 创建新的"代替
