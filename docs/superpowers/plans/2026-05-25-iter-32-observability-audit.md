# iter 32 · 观测性 + 审计日志 · 实施计划

**Spec**：[`docs/superpowers/specs/2026-05-25-iter-32-observability-audit-design.md`](../specs/2026-05-25-iter-32-observability-audit-design.md)
**分支**：`feature/iter-32-observability-audit`

---

## T1 · 审计日志

1. Prisma schema 加 `AuditLog` model + migration `add_audit_log`
2. 新建 `apps/api/src/audit/audit-log.service.ts`：
   - `log({ actor, action, resourceType, resourceId, details, request })` fire-and-forget
   - 失败仅 `Logger.warn`，不抛
3. 新建 `apps/api/src/audit/audit.module.ts`，`@Global()` 让所有 module 直接注入
4. 接入：
   - `auth/local/local.controller.ts` login 成功后
   - `auth/lark/lark.controller.ts` callback 创建账号后
   - `auth/controllers/auth.controller.ts` logout
   - `auth/controllers/me.controller.ts` setPassword / updateProfile / unbindLark
   - `templates/templates.controller.ts` create / update / delete
   - `render/render.service.ts` enqueue（成功入队后）
   - `auth/api-token/api-token.controller.ts` create / revoke
5. 测试 `apps/api/test/audit-log-service.spec.ts`：mock prisma 验证 log() 调用

## T2 · Sentry

1. `pnpm add @sentry/node` in `apps/api`，`@sentry/vue` in `apps/web`
2. `apps/api/src/common/sentry.ts`：`initSentry()` 读 env，dsn 空则 noop
3. `apps/api/src/main.ts` `initSentry()` 在 `NestFactory.create` 前
4. 新建 `apps/api/src/common/sentry.exception-filter.ts`：实现 `ExceptionFilter`，capture exception with context（user / request），仅 5xx + 自定义业务 error 上报；4xx 跳过；过 next（不阻塞默认错误响应）
5. `apps/api/src/main.ts` `app.useGlobalFilters(new SentryExceptionFilter(), ...)`
6. `apps/web/src/main.ts` `Sentry.init` 同款 dsn（前端走 VITE_SENTRY_DSN）
7. .env.example 加 SENTRY_DSN / SENTRY_TRACES_SAMPLE_RATE / APP_VERSION

## T3 · Prometheus

1. `pnpm add prom-client` in `apps/api`
2. 新建 `apps/api/src/metrics/metrics.module.ts`：
   - `MetricsService` 注册全局 registry + 自定义 counters / histograms
   - `MetricsController` `GET /metrics` `@Public @SkipThrottle`，返 `await registry.metrics()`
3. Express middleware：HTTP req count + duration（main.ts 注册）
4. RenderService.enqueue 调 `metrics.renderEnqueued.inc()`
5. RenderService.checkDailyQuota 超限调 `metrics.renderQuotaExceeded.inc()`
6. UserThrottlerGuard 自定义 — 不容易切入，先用 `ThrottlerException` 兜底（可选）
7. worker（apps/render）可后续单独加 metrics endpoint；本 PR 仅 api 端

## T4 · 前端 cleanedAt 收尾

1. `RenderLogsView.vue` 接口加 `cleanedAt: string | null` 字段
2. 列表行：`<span v-if="job.cleanedAt" class="cleaned-mark">已清理</span>`
3. 详情 dialog：if `cleanedAt`，隐藏 `<a href="pdfUrl"... PDF`，加 `<div class="cleaned-notice">输出已于 ... 自动清理</div>`
4. 后端 RenderService.listJobs / get 返字段加 `cleanedAt`
5. RenderLogsView template + 微调样式

## T5 · 验收 + PR

- 单测 audit-log-service.spec.ts PASS
- tsc / vue-tsc / eslint 0 错误
- 手测：login / 改名 / template CRUD → DB audit_log 有行
- 手测：GET /metrics 返 Prometheus 文本
- 手测：渲染日志页对 cleanedAt != null 显示已清理 + 隐藏下载
- PROGRESS 加 §2.13
- push + PR #10

---

## 不在本 PR 范围

- Grafana dashboard 配置
- 审计日志查询页（admin 看 audit_log 列表）
- Loki 日志聚合
- OpenTelemetry 分布式追踪

---

**末**
