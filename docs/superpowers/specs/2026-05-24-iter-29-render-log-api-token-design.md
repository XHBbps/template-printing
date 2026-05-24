# iter 29 — 渲染日志 + API Token 管理 — 设计

> 状态：待用户审  
> 日期：2026-05-24  
> iter 编号：29  
> 相关：[iter 26 异步渲染](../plans/2026-05-23-iter-26-async-render.md) + [iter 27 多维表格触发](2026-05-24-lark-bitable-render-design.md) + [iter 28 机器人卡片](2026-05-24-lark-bot-mention-design.md)

## 1. 目标

把"渲染了什么 / 谁发的 / 怎么进来的"这条**审计与观察**链路打通，并补全外部调用方"无 cookie 集成"的标准方案（Bearer API Token）。

两件事并行：

- **Part A — 渲染日志**：在新路由 `/logs` 列出所有渲染任务，按 RenderJob 表为主，关联 LarkBotSession / LarkPrintRequest 推断来源；详情可看完整 data JSON / 状态 / 错误 / 文件下载。
- **Part B — API Token 管理**：新增 `api_tokens` 表、`/me/api-tokens` 管理视图、`ApiAuthGuard`（Bearer → JWT cookie 两栈回退）。`/api/render` 与 `/api/render/:jobId` 切到新 guard，从此外部脚本不用 cookie 也能调。

## 2. 用户故事

### 2.1 管理员排查"为啥某次没出 PDF"

1. 进 `/logs`
2. 筛选状态 = `failed` + 日期 = 今天
3. 看到一条 jobId `xxx`，来源徽标「飞书机器人」
4. 点[详情] → 看到完整 data、errorMsg、jobId → 复制 jobId 去找飞书会话定位

### 2.2 业务人员看自己的渲染历史

1. 进 `/logs`
2. 看到自己发起过的所有渲染任务（admin 看全部，普通用户只看自己）
3. 点完成的任务[详情]里的「下载 PDF」按钮重新拿文件

### 2.3 集成方接入

1. 登录 → `/me/api-tokens` → 「创建 Token」 → 填名字 "demo-bot"
2. 弹 dialog 显示**一次性**明文 `tpkn_a1b2c3d4...`，点[复制]存好；关 dialog 后再也看不到
3. 在自己服务里：
   ```
   curl -X POST https://print.x.com/api/render \
     -H "Authorization: Bearer tpkn_a1b2c3d4..." \
     -H "Content-Type: application/json" \
     -d '{...}'
   ```
4. 用了几天 → 列表里这条 token 的「最近使用」会更新
5. 不用了或泄露了 → 点[吊销] → 立即失效

## 3. Part A — 渲染日志

### 3.1 路由与导航

| 项 | 内容 |
|---|---|
| 路由 path | `/logs` |
| 路由 name | `render-logs` |
| 视图组件 | `apps/web/src/views/RenderLogsView.vue` |
| sidebar | 新增一项「渲染日志」，图标 `History`（lucide） |
| 权限 | `requiresAuth: true`；服务端按角色返回数据（admin 看全部 / 普通看自己） |

### 3.2 列表视图

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 渲染日志                                                                  │
│ [状态: 全部 ▼]  [来源: 全部 ▼]  [模板搜索]   [刷新]                       │
├──────────────────────────────────────────────────────────────────────────┤
│ 模板          │ 状态        │ 来源           │ 触发时间   │ 用时   │ 操作 │
│ 出门证Demo    │ ✅ 已完成   │ 飞书机器人     │ 11:23:00   │ 1.4s   │详情 │
│ 出门证Demo    │ ⏳ 处理中   │ 飞书多维表格   │ 11:22:50   │ —      │详情 │
│ 价签          │ ❌ 失败     │ API 直调       │ 11:22:00   │ 2.1s   │详情 │
│ ...                                                                      │
│                                          [分页 20 / 页 ←  1 2 3  → ]      │
└──────────────────────────────────────────────────────────────────────────┘
```

字段：

- **模板**：JOIN `templates.name`（如果模板已删则显示 "已删除模板"）
- **状态**：来自 `render_jobs.status`，用 Element Plus tag colored
- **来源**：推断逻辑见 §3.4
- **触发时间**：`createdAt`
- **用时**：`completedAt - createdAt`（如有）
- **操作**：「详情」按钮 → 弹 dialog

### 3.3 详情 dialog

```
┌─ 渲染任务详情 ─────────────────────────┐
│ Job ID:   abc-123-...     [复制]       │
│ 模板:     出门证Demo                    │
│ 状态:     ✅ 已完成                     │
│ 来源:     飞书机器人                    │
│ 触发时间: 2026-05-24 11:23:00          │
│ 完成时间: 2026-05-24 11:23:01          │
│ Callback: http://api:3000/lark/bot/... │
│                                         │
│ ─── 请求数据 ───                       │
│ {                                       │
│   "group": "扬机",                      │
│   "material_num": "10100"               │
│ }                                       │
│                                         │
│ ─── 输出 ───                            │
│ [📥 下载 PDF]  [📥 下载 PNG]            │
│                                         │
│ ─── 错误信息 ─── (失败时显示)          │
│ Waiting failed: 30000ms exceeded        │
└─────────────────────────────────────────┘
```

### 3.4 来源识别

无需新增 DB 字段，靠现有关联表 LEFT JOIN 推断：

| 关联状态 | 来源 |
|---|---|
| 有 `lark_bot_sessions.render_job_id = render_jobs.id` | 飞书机器人 |
| 有 `lark_print_requests.render_job_id = render_jobs.id` | 飞书多维表格 |
| 都没有 | API 直调 |

注：一个 RenderJob 不会同时来自两个集成（两表都有 `@unique` 的 renderJobId 约束）。

### 3.5 后端 API

**`GET /api/render/jobs`** — 渲染任务列表（分页）

Query 参数：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | 1 | 页码 |
| `pageSize` | int | 20 | 每页条数，最大 100 |
| `status` | string? | — | 过滤：pending/processing/done/failed |
| `source` | string? | — | 过滤：bot/bitable/api |
| `templateName` | string? | — | 模板名模糊搜索 |

响应：

```json
{
  "items": [
    {
      "id": "abc-...",
      "templateId": "...",
      "templateName": "出门证Demo",
      "status": "done",
      "source": "bot",
      "createdAt": "...",
      "completedAt": "...",
      "durationMs": 1400,
      "pdfUrl": "/uploads/render/abc.pdf",
      "pngUrl": null,
      "errorMsg": null
    }
  ],
  "total": 137,
  "page": 1,
  "pageSize": 20
}
```

权限：

- admin / emergency_admin → 返回所有
- 普通用户 → 只返回 `templates.ownerId = me.id` 的（通过 templateId 链路过滤）

**`GET /api/render/:jobId`**（已有）—— 升级响应字段：增加 `source` / `templateName` / `data`（请求 data JSON），方便详情 dialog 拉一次拿全。

### 3.6 SQL 设计

```sql
SELECT
  rj.id, rj.template_id, rj.status, rj.data, rj.callback_url,
  rj.created_at, rj.completed_at, rj.pdf_url, rj.png_url, rj.error_msg,
  t.name AS template_name,
  t.owner_id,
  CASE
    WHEN lbs.id IS NOT NULL THEN 'bot'
    WHEN lpr.id IS NOT NULL THEN 'bitable'
    ELSE 'api'
  END AS source
FROM render_jobs rj
LEFT JOIN templates t ON t.id = rj.template_id
LEFT JOIN lark_bot_sessions lbs ON lbs.render_job_id = rj.id
LEFT JOIN lark_print_requests lpr ON lpr.render_job_id = rj.id
WHERE
  ($admin OR t.owner_id = $userId)
  AND ($status IS NULL OR rj.status = $status)
  AND ($source IS NULL OR <case logic>)
  AND ($templateName IS NULL OR t.name ILIKE '%' || $templateName || '%')
ORDER BY rj.created_at DESC
LIMIT $pageSize OFFSET $offset;
```

Prisma 用 `findMany` + `include: { template, larkBotSession, larkPrintRequest }`，前端把 include 结果映射为 `source` 即可，避免写 raw SQL。

## 4. Part B — API Token 管理

### 4.1 数据模型

```prisma
model ApiToken {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  name        String                                 // 用户自定义名字（如 "demo-bot"）
  tokenHash   String    @unique @map("token_hash")   // SHA-256(plaintext)，存 hex
  prefix      String                                 // 'tpkn_' + 8 字符前缀，用于列表展示

  lastUsedAt  DateTime? @map("last_used_at")
  revokedAt   DateTime? @map("revoked_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([userId, revokedAt])
  @@map("api_tokens")
}
```

User model 加反向 `apiTokens ApiToken[]`。

### 4.2 Token 格式与生成

- 明文格式：`tpkn_<32 hex>`，共 37 字符
- 前缀 `tpkn_` 让用户、日志、grep 一眼看出是 token（类 GitHub `ghp_` / `gho_`）
- 生成：`crypto.randomBytes(16).toString('hex')` → 32 hex → 拼前缀
- 哈希：`crypto.createHash('sha256').update(plaintext).digest('hex')` 存 DB
- 列表展示：`tpkn_a1b2c3d4...`（前 8 字符 + `…`）

### 4.3 端点

| 端点 | 鉴权 | 行为 |
|---|---|---|
| `GET /users/me/api-tokens` | JWT cookie | 列出当前用户的 token（不含 hash / plaintext） |
| `POST /users/me/api-tokens` | JWT cookie | 创建一个 token，返回**一次性**明文 + 元信息 |
| `DELETE /users/me/api-tokens/:id` | JWT cookie | 软删（设 revokedAt） |

**注意**：管理端点本身**只允许 cookie 鉴权**（避免 token 自我管理 token 的环）。

### 4.4 `ApiAuthGuard`

新建 `apps/api/src/auth/guards/api-auth.guard.ts`：

```ts
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;

    // Path 1: Bearer token
    if (auth && auth.startsWith('Bearer tpkn_')) {
      const plaintext = auth.slice('Bearer '.length);
      const hash = sha256(plaintext);
      const token = await this.prisma.apiToken.findUnique({
        where: { tokenHash: hash },
        include: { user: true },
      });
      if (!token || token.revokedAt) throw new UnauthorizedException('invalid_or_revoked_token');
      // attach user + 异步更新 lastUsedAt（不阻塞响应）
      req.user = { sub: token.user.id, role: token.user.role };
      this.prisma.apiToken
        .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
      return true;
    }

    // Path 2: fallback to JWT cookie
    return this.jwt.canActivate(ctx);
  }
}
```

应用范围：

- `RenderController` 全部端点（`POST /render`, `GET /render/:jobId`, `GET /render/jobs`）
- 其他端点（auth / templates / lark / api-tokens 自己）保持 `JwtAuthGuard`

### 4.5 前端视图 `/me/api-tokens`

```
┌─ API Token 管理 ──────────────────────────────────────┐
│ 用于在脚本 / 集成 / 自动化中调用 /api/render 系列接口。│
│                                      [+ 创建 Token]    │
├────────────────────────────────────────────────────────┤
│ 名称       │ 前缀          │ 创建时间  │ 最近使用  │ 操作 │
│ demo-bot   │ tpkn_a1b2c3...│ 2026-05-24│ 5 分钟前  │ 吊销 │
│ ci-script  │ tpkn_xx...    │ 2026-05-20│ —         │ 吊销 │
└────────────────────────────────────────────────────────┘
```

**创建 dialog**：

```
┌─ 创建新 Token ─────────────────────────────┐
│ 名称 *  [demo-bot                      ]   │
│                                             │
│              [取消]  [生成]                 │
└─────────────────────────────────────────────┘
```

**创建后弹"明文一次性显示"对话框**：

```
┌─ Token 已创建 ──────────────────────────────────────────┐
│ ⚠️ Token 仅这一次完整显示，请立即复制保存。关闭后无法再看 │
│                                                          │
│ tpkn_a1b2c3d4e5f60718a9bcdef0123456789      [📋 复制]   │
│                                                          │
│                                            [我已复制]    │
└──────────────────────────────────────────────────────────┘
```

## 5. 不在范围（留后续）

- **Token scope / 权限分级**（read-only / full / scoped to template）
- **Token 过期时间**（auto-expire after N days）
- **Token IP 白名单**
- **Token 使用量统计** / 计费
- **渲染日志导出 CSV**
- **「模板平台打印」（设计器立即打印）记录到日志**（需要新打点机制，跟 render_jobs 不是同一条路径）
- 渲染日志保留期 / 清理 cron

## 6. 验收标准

- [ ] DB：`api_tokens` 表 + migration
- [ ] `/users/me/api-tokens` 三个端点（GET / POST / DELETE）+ 测试覆盖
- [ ] `ApiAuthGuard` 两栈回退（Bearer → JWT），应用于 `/api/render` 系列
- [ ] `/me/api-tokens` 视图：列表 + 创建（一次性明文）+ 吊销
- [ ] 真实 Bearer token 调用 `/api/render` 成功（curl 测试）
- [ ] `GET /api/render/jobs` 端点 + 过滤 / 分页 / 权限隔离
- [ ] `/logs` 视图：列表 + 详情 dialog + 三种来源徽标 + sidebar 入口
- [ ] PROGRESS.md 同步
- [ ] CI 通过

## 7. Task 拆分

预计 8 个 task，依赖顺序如下：

```
T1 (DB: api_tokens)
  └─▶ T2 (ApiToken service + crypto)
        └─▶ T3 (/users/me/api-tokens CRUD)
              └─▶ T4 (ApiAuthGuard + render 端点切换)

T5 (Web: /me/api-tokens 视图)   [可与 T2-T4 并行写前端 mock 数据]

T6 (Backend: GET /api/render/jobs join + 分页)
  └─▶ T7 (Web: /logs 视图 + 详情 dialog + sidebar 入口)

T8 (PROGRESS 同步 + 端到端验证)
```

详见 plan 文档。
