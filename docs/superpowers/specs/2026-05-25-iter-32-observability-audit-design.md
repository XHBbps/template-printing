# iter 32 · 观测性 + 审计日志 · 设计

**日期**：2026-05-25
**Spec author**：Claude Code
**范围**：apps/api + apps/web（轻量观测性 + 强合规审计）
**用户规模**：扬力集团 2000+

---

## 1. 背景

iter 31 已解决生产部署 3 个 blocker（Signed URL / 重试 + 限流 / Quota + 清理）。但还有两个"无法盲跑"的缺口：

### 1.1 观测性 — 出问题没人知道

部署到 2000 人后，故障没有信号源：
- Render worker OOM 没人发现
- 用户报"我创建模板失败"，无法重现 / 没有 stack trace
- bullmq queue 堆积无监控
- 慢 SQL / N+1 query 无指标

最小观测性堆栈应包含：
- **错误追踪**（Sentry）— 异常自动捕获 + 上下文 + 通知
- **指标**（Prometheus）— ops 可 scrape 接 Grafana 看 dashboard

### 1.2 审计日志 — 合规缺口

2000 人内部应用必须能回答：
- 谁删了哪个模板？
- 谁修改了谁的密码？
- 谁触发了哪些渲染任务？
- 谁创建了 / 吊销了哪些 API token？
- 谁解绑了飞书账号？

当前 `render_jobs` 留下了渲染历史，但其他敏感动作（CRUD / 鉴权状态变化 / 解绑等）零审计。

### 1.3 前端 iter 31 收尾

iter 31 T5 自动清理后，DB 仍有 render_jobs 记录但 pdfUrl/pngUrl = NULL + cleanedAt 有值。`/logs` 详情 dialog 需要：
- 行列表显示「已清理」状态
- 详情 dialog 隐藏下载按钮 + 显示清理时间

---

## 2. 详细设计

### 2.1 审计日志（T1）

#### DB schema

新表 `audit_log`：

```prisma
model AuditLog {
  id           String   @id @default(uuid())
  actorId      String?  @map("actor_id")          // null = 系统调用 / 飞书 webhook
  actorName    String?  @map("actor_name")        // 冗余存名字，user 删除后审计仍可读
  action       String                              // 'template.delete' / 'token.revoke' 等点分式
  resourceType String?  @map("resource_type")     // 'template' / 'render_job' / 'api_token' / 'user'
  resourceId   String?  @map("resource_id")
  details      Json?                               // 可选额外信息（旧值 / 新值 / 失败原因）
  ip           String?                             // 可选审计辅助
  userAgent    String?  @map("user_agent")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([actorId, createdAt(sort: Desc)])
  @@index([action, createdAt(sort: Desc)])
  @@index([resourceType, resourceId])
  @@map("audit_log")
}
```

#### AuditLogService

```ts
@Injectable()
class AuditLogService {
  async log(args: {
    actor: { id: string; name: string } | null;
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    request?: Request;  // 可从 req 提 ip + ua
  }): Promise<void>
}
```

实现要点：
- fire-and-forget（不阻塞业务）— 失败仅 log warn
- actor=null 表示系统调用 / Lark webhook
- DB 写入异步（`void this.audit.log(...)`），不在 critical path

#### 接入点（关键动作）

| Action | 来源 | actor | resource |
|---|---|---|---|
| `user.login.local` | LocalController | username 命中的 user | user/<id> |
| `user.login.lark` | LarkController.callback | 飞书新用户 | user/<id> |
| `user.logout` | AuthController.logout | currentUser | user/<id> |
| `user.password.change` | MeController.setPassword | currentUser | user/<id> |
| `user.profile.update` | MeController.updateProfile | currentUser | user/<id>，details={old, new} |
| `user.lark.unbind` | MeController.unbindLark | currentUser | user/<id> |
| `template.create` | TemplatesController | currentUser | template/<id>，details={name} |
| `template.update` | TemplatesController | currentUser | template/<id>，details={name?} |
| `template.delete` | TemplatesController | currentUser | template/<id>，details={name} |
| `render.enqueue` | RenderService.enqueue | currentUser | render_job/<id>，details={templateId} |
| `token.create` | ApiTokenController | currentUser | api_token/<id>，details={name} |
| `token.revoke` | ApiTokenController | currentUser | api_token/<id> |

不接入：
- `/render/jobs` 列表查询（读操作不审计）
- healthz / metrics（基础设施）
- file 下载（高频）

### 2.2 Sentry（T2）

#### 包

`@sentry/node` 8.x（与 Nest 10 兼容）。

#### 配置

```ts
// main.ts before app.listen
Sentry.init({
  dsn: process.env.SENTRY_DSN,                   // 不设 = 关闭
  environment: process.env.NODE_ENV ?? 'dev',
  tracesSampleRate: 0.1,                          // 性能追踪 10% 采样
  release: process.env.APP_VERSION ?? 'dev',
  beforeSend(event) {
    // 过滤鉴权错误（401/403）— 这些是预期，不需要 Sentry alert
    if (event.exception?.values?.[0]?.type?.includes('Unauthorized')) return null;
    return event;
  },
});
```

#### 集成

- `SentryExceptionFilter` 实现 Nest `ExceptionFilter`，拦截所有未处理异常并 capture + 上下文（user / request / 4xx 跳过）
- `app.useGlobalFilters(new SentryExceptionFilter(), httpFilter)`
- Express middleware 自动 trace 性能（HTTP timing）

#### 前端

`@sentry/vue` + `@sentry/tracing`：
- main.ts init 同样的 dsn
- 默认 captureUncaughtError + vue errorHandler
- 暂只装包 + 初始化，详细配置（user identification / breadcrumbs）留后续

#### 默认不开

ENV `SENTRY_DSN` 不设 = Sentry 关闭（dev / 本地）。运维填上线时配。

### 2.3 Prometheus metrics（T3）

#### 包

`prom-client` 15.x（Node.js 官方 Prometheus 客户端）。

#### Metrics

| Metric | Type | Labels | 来源 |
|---|---|---|---|
| `tp_http_requests_total` | Counter | method / route / status_code | Express middleware |
| `tp_http_request_duration_seconds` | Histogram | method / route | Express middleware |
| `tp_render_jobs_total` | Counter | status (enqueued/done/failed) / source (api/bot/bitable) | RenderService.enqueue + worker callback hooks |
| `tp_render_quota_exceeded_total` | Counter | — | RenderService.checkDailyQuota |
| `tp_render_rate_limit_total` | Counter | — | UserThrottlerGuard exception |
| `tp_bullmq_jobs_active` | Gauge | queue | bullmq event listener |
| `tp_bullmq_jobs_waiting` | Gauge | queue | bullmq event listener |
| Node default | — | — | `prom-client` defaultMetrics |

#### Endpoint

`GET /metrics` `@Public()` `@SkipThrottle()`，返 `text/plain` Prometheus exposition format。

ops 在 Prometheus scrape config 加 `/metrics` 即可。

### 2.4 前端 cleanedAt 收尾（T4）

RenderLogsView：

- 列表行：在 status 列前加 `<span v-if="cleanedAt" class="cleaned-mark">已清理</span>`（fg-3 mono 小字标识）
- 详情 dialog：
  - 如果 `cleanedAt != null`：
    - 隐藏 PDF / PNG 下载按钮
    - 「输出」section 改显示 `<div class="cleaned-notice">本任务的输出已于 {{ formatAbs(cleanedAt) }} 自动清理（30 天后清盘）</div>`
  - 否则保持原下载按钮

后端 `listJobs` 已经返 `cleanedAt`（但当前 select 没列；T4 也得改 SELECT）。

---

## 3. 配置项

| ENV | 默认 | 说明 |
|---|---|---|
| `SENTRY_DSN` | undefined（关闭） | Sentry 项目 DSN |
| `SENTRY_TRACES_SAMPLE_RATE` | 0.1 | 性能追踪采样率 |
| `APP_VERSION` | 'dev' | 用于 Sentry release tag（CI 注入 git sha） |

---

## 4. 数据库迁移

```sql
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  details       JSONB,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_actor_created ON audit_log(actor_id, created_at DESC);
CREATE INDEX audit_log_action_created ON audit_log(action, created_at DESC);
CREATE INDEX audit_log_resource ON audit_log(resource_type, resource_id);
```

Prisma schema 同步加，生成 migration `add_audit_log`。

---

## 5. 验收 checklist

- [ ] DB 迁移成功 + Prisma client 生成
- [ ] Login / logout / 改名字 / 改密 / 解绑飞书 → audit_log 有记录
- [ ] Template create/update/delete → audit_log 有记录（含 name / id）
- [ ] Render enqueue → audit_log 有记录
- [ ] Token create / revoke → audit_log 有记录
- [ ] AuditLogService 失败不影响业务（mock 抛错 + 业务仍成功）
- [ ] SENTRY_DSN 未设 = Sentry 关闭，应用启动无错
- [ ] 故意 throw → Sentry capture（需运维填实际 DSN 测）
- [ ] `GET /metrics` 返 200 + Prometheus 格式
- [ ] 指标包含 HTTP / render / quota / rate-limit / bullmq 信号
- [ ] `/logs` 列表对 cleanedAt != null 显示「已清理」
- [ ] `/logs` 详情 dialog 对 cleanedAt != null 隐藏下载 + 显示清理时间
- [ ] vue-tsc / tsc / eslint 0 错误

---

## 6. 不在本 PR 范围

- Loki / 日志聚合（pino 已结构化）
- Grafana dashboard 配置（ops 配，repo 给 metric 名清单）
- 分布式追踪（OpenTelemetry）— 单节点暂不需要
- 审计日志查询页（admin 查 audit_log 列表）— iter 33
- 通知告警（Slack / 飞书）— ops 配 Sentry 自带

---

**末**
