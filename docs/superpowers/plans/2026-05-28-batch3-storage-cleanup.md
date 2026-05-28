# 批次3:存储清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 堵住磁盘/DB 无限增长:修 RENDER_DIR 路径 bug(渲染产物不被清 + 签名下载 404)、清理孤儿上传图片(P1)、审计日志保留(P2)、飞书会话保留(P12)。

**Architecture:** 全部扩展现有 `apps/api/src/render/render-cleanup.service.ts`(已是 `@Cron` 清理服务,已 import fs/path/STORAGE_ROOT/PrismaService/Logger,依赖齐全)+ 修 `signed-uploads.controller.ts` 的同源路径常量。每项 TDD + e2e(命中真实 DB / 真实 `/storage`)。

**Tech Stack:** NestJS + @nestjs/schedule + Prisma(PostgreSQL)+ Jest;`apps/api` 容器跑测试。

**Spec:** `docs/superpowers/specs/2026-05-28-system-review-audit.md`(P1/P2/P12)+ 规划期发现的 RENDER_DIR bug。

**全局约定:** 测试 `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- <file>"`(e2e 命中真实 DB,容器内 `STORAGE_ROOT=/storage` 可写);typecheck/lint 同容器。husky 提交不 `--no-verify`,每 task 只 `git add` 本 task 文件。用 `@jest/globals`。不改渲染/入队/前端。

**已核实事实:**
- 渲染器写产物到 `STORAGE_ROOT/uploads/render/`,URL `/uploads/render/<id>.{pdf,png}`(`apps/render/src/renderer.ts:82,114`)。
- 但 `signed-uploads.controller.ts:25` 与 `render-cleanup.service.ts:17` 的 `RENDER_DIR = path.join(STORAGE_ROOT, 'render')`(**少 `uploads/`**)→ 产物清理删错路径(永不清)+ 签名下载从错路径取(404)。
- 上传图片写 `STORAGE_ROOT/uploads/<sha256>.<ext>`,URL `/uploads/<file>`,内容寻址(同图同文件);URL 嵌入 `templates.data` 与 `template_versions.data`。
- `AuditLog.createdAt`(`@default(now())`,可在 create 时设);`LarkBotSession.state`('done'/'failed'/'select_template'…)+ `updatedAt`(`@updatedAt`,Prisma 托管 → 测试需用 `$executeRaw` 回填 `updated_at`)。
- 现有 cron:`cleanupOldOutputs`(EVERY_DAY_AT_3AM)、`reconcileStuckJobs`(EVERY_5_MINUTES)。

---

## File Structure
- Modify `apps/api/src/uploads/signed-uploads.controller.ts`(RENDER_DIR)(Task1)
- Modify `apps/api/src/render/render-cleanup.service.ts`(RENDER_DIR + 3 个新 cron)(Task1-4)
- Create `apps/api/test/render-dir-fix.e2e.spec.ts`、`orphan-uploads-cleanup.e2e.spec.ts`、`audit-log-cleanup.e2e.spec.ts`、`bot-session-cleanup.e2e.spec.ts`(Task1-4)
- Modify `.env.example`、`.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`、`docs/deployment.md`、PROGRESS、review spec(Task5)

---

## Task 1:修 RENDER_DIR 路径 bug(渲染产物清理 + 签名下载)

**Files:** Modify `apps/api/src/uploads/signed-uploads.controller.ts:25`、`apps/api/src/render/render-cleanup.service.ts:17`;Test `apps/api/test/render-dir-fix.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/render-dir-fix.e2e.spec.ts`(照搬同目录 e2e bootstrap;`STORAGE_ROOT` 容器内 `/storage`)。两断言:
1. **签名下载路径对**:`fs.writeFile(/storage/uploads/render/sigtest.pdf, ...)`,用 `app.get(FileSigService).signUrl('/uploads/render/sigtest.pdf')` 拿带 token 的 URL,supertest GET 该路径 → **200**(修复前从 `/storage/render/` 找 → 404)。用后删该文件。
2. **产物清理删对路径**:prisma 造一个 `renderJob`(status='done',`createdAt` 设 60 天前,`pdfUrl='/uploads/render/cleantest.pdf'`),`fs.writeFile(/storage/uploads/render/cleantest.pdf)`,调 `app.get(RenderCleanupService).cleanupOldOutputs()`(`RENDER_CLEANUP_DAYS` 默认 30,60 天前会命中)→ 断言文件**被删** + job.cleanedAt 非空。(修复前删 `/storage/render/cleantest.pdf` 不存在→ ENOENT 吞掉→ 真文件残留。)
afterAll 清理造的 job/文件。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-dir-fix.e2e.spec.ts"`
Expected: FAIL(签名 GET 404;清理后文件仍在)。

- [ ] **Step 3: 修两处 RENDER_DIR**

`apps/api/src/uploads/signed-uploads.controller.ts:25` 与 `apps/api/src/render/render-cleanup.service.ts:17`,把:
```ts
const RENDER_DIR = path.join(STORAGE_ROOT, 'render');
```
改为:
```ts
const RENDER_DIR = path.join(STORAGE_ROOT, 'uploads', 'render');
```
(两文件都改;signed-uploads 的 path-traversal 守卫用 RENDER_DIR 作前缀,基准随之正确;cleanupOldOutputs 的 `path.join(RENDER_DIR, filename)` 随之指向真实产物。)

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/render-dir-fix.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`
另跑既有 `uploads.e2e.spec.ts` 确认无回归。

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/uploads/signed-uploads.controller.ts apps/api/src/render/render-cleanup.service.ts apps/api/test/render-dir-fix.e2e.spec.ts
git commit -m "fix(api): 修 RENDER_DIR 漏 uploads/ 路径 bug——渲染产物清理删对路径 + 签名下载不再 404"
```

---

## Task 2(P1):孤儿上传图片清理(扫描式)

**Files:** Modify `apps/api/src/render/render-cleanup.service.ts`(加 `cleanupOrphanUploads`);Test `apps/api/test/orphan-uploads-cleanup.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/orphan-uploads-cleanup.e2e.spec.ts`:
- 造一个 owner user + 一个 template,其 `data` JSON 含 `"url":"/uploads/keep.png"`(image 元素;最小 schema-valid 即可,读 packages/schema 确认必填,或直接放一个含该字符串的简化 data—— cleanup 只扫 `data::text`,不校验 schema,可用简化 JSON)。
- 在 `/storage/uploads/` 造三文件:`keep.png`(被引用)、`orphan.png`(未引用,`fs.utimes` 把 mtime 设为 30 天前)、`recent.png`(未引用,mtime 现在);并造 `/storage/uploads/render/subdir-guard.pdf`(子目录文件,应不被动)。
- 调 `app.get(RenderCleanupService).cleanupOrphanUploads()`(`UPLOAD_ORPHAN_GRACE_DAYS` 默认 7)。
- 断言:`keep.png` 在、`orphan.png` 删、`recent.png` 在(宽限期内)、`uploads/render/subdir-guard.pdf` 在(子目录不动)。
afterAll 清理造的文件/模板/user。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/orphan-uploads-cleanup.e2e.spec.ts"`
Expected: FAIL(`cleanupOrphanUploads` 不存在)。

- [ ] **Step 3: 实现 cleanupOrphanUploads**

在 `render-cleanup.service.ts` 加(`reconcileStuckJobs` 之后):
```ts
  /**
   * P1(系统 review):清理无任何模板引用的孤儿上传图片,防 /storage/uploads 无限增长。
   * 内容寻址(sha256 文件名)→ 引用集 = templates.data + template_versions.data 中所有 /uploads/<file>。
   * 仅删「不在引用集 且 mtime 早于 UPLOAD_ORPHAN_GRACE_DAYS(默认7,0=关)」的顶层文件;
   * render/ 子目录(渲染产物)由 cleanupOldOutputs 负责,这里按"仅顶层文件"自然排除。
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupOrphanUploads(): Promise<void> {
    const graceDays = Number(process.env.UPLOAD_ORPHAN_GRACE_DAYS ?? 7);
    if (!Number.isFinite(graceDays) || graceDays <= 0) {
      this.log.log('UPLOAD_ORPHAN_GRACE_DAYS <= 0, skip orphan-uploads cleanup');
      return;
    }
    const uploadsDir = path.join(STORAGE_ROOT, 'uploads');
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(uploadsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const files = entries.filter((d) => d.isFile()).map((d) => d.name); // 顶层文件,排除 render/ 子目录
    if (files.length === 0) return;

    // 引用集:扫 templates.data + template_versions.data 的 /uploads/<file>
    const rows = await this.prisma.$queryRaw<Array<{ data: string }>>`
      SELECT data::text AS data FROM templates WHERE data::text LIKE '%/uploads/%'
      UNION ALL
      SELECT data::text AS data FROM template_versions WHERE data::text LIKE '%/uploads/%'`;
    const referenced = new Set<string>();
    const re = /\/uploads\/([A-Za-z0-9._-]+)/g;
    for (const r of rows) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(r.data)) !== null) referenced.add(m[1]);
    }

    const cutoff = Date.now() - graceDays * 86400 * 1000;
    let deleted = 0;
    for (const name of files) {
      if (referenced.has(name)) continue;
      const full = path.join(uploadsDir, name);
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs >= cutoff) continue; // 宽限期内(刚上传未存模板)
        await fs.unlink(full);
        deleted++;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') this.log.warn(`orphan unlink ${full} failed: ${(e as Error).message}`);
      }
    }
    this.log.log(`orphan-uploads cleanup: ${deleted} unreferenced file(s) removed (grace ${graceDays}d)`);
  }
```
> 说明:正则在 render URL `/uploads/render/<id>.pdf` 上会捕获到 `render` 段(遇 `/` 停),无害(无名为 `render` 的顶层文件;render 目录被 isFile 过滤)。`$queryRaw` 用 `data::text` + `LIKE '%/uploads/%'` 缩小行集。

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/orphan-uploads-cleanup.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/render/render-cleanup.service.ts apps/api/test/orphan-uploads-cleanup.e2e.spec.ts
git commit -m "feat(api): 孤儿上传图片清理 cron(扫描式,防 /storage/uploads 无限增长)(P1)"
```

---

## Task 3(P2):审计日志保留清理

**Files:** Modify `apps/api/src/render/render-cleanup.service.ts`(加 `cleanupAuditLog`);Test `apps/api/test/audit-log-cleanup.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/audit-log-cleanup.e2e.spec.ts`:用 prisma 插两条 `auditLog`——一条 `createdAt` 设 120 天前(action='test.old'),一条现在(action='test.recent');设 `process.env.AUDIT_LOG_RETENTION_DAYS='90'`;调 `cleanupAuditLog()`;断言旧的被删(`findFirst test.old` = null)、新的在。afterAll 删 `test.recent`。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/audit-log-cleanup.e2e.spec.ts"`
Expected: FAIL(`cleanupAuditLog` 不存在)。

- [ ] **Step 3: 实现 cleanupAuditLog**

在 `render-cleanup.service.ts` 加:
```ts
  /**
   * P2(系统 review):审计日志保留清理,防 audit_log 无限增长。
   * 删 createdAt 早于 AUDIT_LOG_RETENTION_DAYS(默认90,≤0 关)的行。
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupAuditLog(): Promise<void> {
    const days = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
    if (!Number.isFinite(days) || days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86400 * 1000);
    const { count } = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) this.log.log(`audit-log cleanup: ${count} row(s) older than ${days}d removed`);
  }
```

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/audit-log-cleanup.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/render/render-cleanup.service.ts apps/api/test/audit-log-cleanup.e2e.spec.ts
git commit -m "feat(api): 审计日志保留清理 cron(默认90天,防 audit_log 无限增长)(P2)"
```

---

## Task 4(P12):飞书机器人会话清理

**Files:** Modify `apps/api/src/render/render-cleanup.service.ts`(加 `cleanupBotSessions`);Test `apps/api/test/bot-session-cleanup.e2e.spec.ts`(新)。

- [ ] **Step 1: 写失败 e2e**

新建 `apps/api/test/bot-session-cleanup.e2e.spec.ts`:插 4 条 `larkBotSession`——① state='done' 旧、② state='failed' 旧、③ state='done' 新、④ state='select_template'(活动态)旧。
**注意**:`updatedAt` 是 `@updatedAt`(Prisma 托管,create 无法直接设),旧的须 create 后用 `$executeRaw` 回填:
```ts
await prisma.$executeRaw`UPDATE lark_bot_sessions SET updated_at = ${oldDate} WHERE id = ${id}`;
```
(`oldDate` = 60 天前 Date;新的不回填即为 now。)设 `process.env.BOT_SESSION_RETENTION_DAYS='30'`;调 `cleanupBotSessions()`;断言:①② 删、③(新 done)在、④(活动态,即便旧)在。afterAll 删剩余测试会话(按造的 chatId 前缀)。

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/bot-session-cleanup.e2e.spec.ts"`
Expected: FAIL(`cleanupBotSessions` 不存在)。

- [ ] **Step 3: 实现 cleanupBotSessions**

在 `render-cleanup.service.ts` 加:
```ts
  /**
   * P12(系统 review):清理已终态(done/failed)的飞书机器人会话,防 lark_bot_sessions 无限增长。
   * 删 state in (done,failed) 且 updatedAt 早于 BOT_SESSION_RETENTION_DAYS(默认30,≤0 关)的行。
   * 进行中的会话(select_template/fill_fields/rendering)不删。
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupBotSessions(): Promise<void> {
    const days = Number(process.env.BOT_SESSION_RETENTION_DAYS ?? 30);
    if (!Number.isFinite(days) || days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86400 * 1000);
    const { count } = await this.prisma.larkBotSession.deleteMany({
      where: { state: { in: ['done', 'failed'] }, updatedAt: { lt: cutoff } },
    });
    if (count > 0) this.log.log(`bot-session cleanup: ${count} done/failed session(s) older than ${days}d removed`);
  }
```
> 说明:`LarkBotSession.renderJobId` 是指向 RenderJob 的 FK(关系侧 onDelete SetNull)——删会话行不影响 RenderJob,无级联风险。

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/bot-session-cleanup.e2e.spec.ts && pnpm run typecheck && pnpm run lint"`

- [ ] **Step 5: 提交**
```bash
git add apps/api/src/render/render-cleanup.service.ts apps/api/test/bot-session-cleanup.e2e.spec.ts
git commit -m "feat(api): 飞书机器人 done/failed 会话清理 cron(默认30天)(P12)"
```

---

## Task 5:env + 文档 + 全量回归

**Files:** Modify `.env.example`、`.env.prod.example`、`apps/api/test/env-example-sync.spec.ts`、`docs/deployment.md`、`docs/PROGRESS.md`、review spec。

- [ ] **Step 1: `.env.example` + `.env.prod.example` 加清理 env**

两文件渲染/清理段追加(`.env.example` 已有 `RENDER_CLEANUP_DAYS`,在其附近):
```bash
UPLOAD_ORPHAN_GRACE_DAYS=7     # 孤儿上传图片清理宽限(天),0=关
AUDIT_LOG_RETENTION_DAYS=90    # 审计日志保留(天),0=关
BOT_SESSION_RETENTION_DAYS=30  # 飞书 done/failed 会话保留(天),0=关
```

- [ ] **Step 2: 更新双向校验测试的允许清单(关键,否则 .env.prod.example 校验会挂)**

`apps/api/test/env-example-sync.spec.ts` 的 `NON_ENVTS_ALLOWED` Set 加这三个键(它们是 `process.env` 读取、非 `env.ts` schema 字段):
```ts
  'UPLOAD_ORPHAN_GRACE_DAYS', 'AUDIT_LOG_RETENTION_DAYS', 'BOT_SESSION_RETENTION_DAYS',
```
(同时确认 `RENDER_CLEANUP_DAYS` 若也加进 `.env.prod.example` 则一并加入 allowlist。)
Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- test/env-example-sync.spec.ts"` → 两断言仍过。

- [ ] **Step 3: `docs/deployment.md` 补说明**

在渲染/运维段补:`UPLOAD_ORPHAN_GRACE_DAYS`/`AUDIT_LOG_RETENTION_DAYS`/`BOT_SESSION_RETENTION_DAYS` 含义 + 默认 + 0=关;并提及修复后渲染产物清理(`cleanupOldOutputs`)与签名下载现指向 `uploads/render/`。

- [ ] **Step 4: 全量 api 测试**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test && pnpm run typecheck && pnpm run lint"`
Expected: 全绿、无回归。

- [ ] **Step 5: PROGRESS + review spec 标记**

`docs/PROGRESS.md` `### 2026-05-28` 追加批次3 条目(RENDER_DIR 修复 + P1/P2/P12);review spec 对 P1/P2/P12 标「✅ 批次3 已修」+ 记 RENDER_DIR bug 发现并修复。更新"最近更新"日期。

- [ ] **Step 6: 提交**
```bash
git add .env.example .env.prod.example apps/api/test/env-example-sync.spec.ts docs/deployment.md docs/PROGRESS.md docs/superpowers/specs/2026-05-28-system-review-audit.md
git commit -m "docs: 批次3 存储清理 env + 文档 + review 项标记已修(含 RENDER_DIR 修复)"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** RENDER_DIR bug→T1 ✅;P1→T2 ✅;P2→T3 ✅;P12→T4 ✅;env/文档/回归→T5 ✅。

**占位符扫描:** 无 TBD;四个 cron、RENDER_DIR 修正、各 e2e 思路(含 mtime/`updated_at` 回填手法)、env 清单均给出完整代码/命令。e2e 标"照搬同目录 bootstrap"是对现有约定的引用(各 e2e 文件已有 AppModule+supertest+prisma 模式)。

**类型/一致性:** 四个新方法名 `cleanupOrphanUploads`/`cleanupAuditLog`/`cleanupBotSessions`(+ 既有 `cleanupOldOutputs`)与 e2e 调用一致;RENDER_DIR 两文件同改 `STORAGE_ROOT/uploads/render`;env 键 `UPLOAD_ORPHAN_GRACE_DAYS`/`AUDIT_LOG_RETENTION_DAYS`/`BOT_SESSION_RETENTION_DAYS` 在 service、.env.example、.env.prod.example、env-example-sync 的 NON_ENVTS_ALLOWED 四处一致;`LarkBotSession.updatedAt` 是 `@updatedAt`,T4 测试用 `$executeRaw` 回填(已点明)。

**风险点:** T2 正则提取依赖 URL 形如 `/uploads/<filename>`(确为 storeImage 返回格式);宽限期防误删刚上传文件;子目录用 `isFile()` 排除。T4 `updatedAt` 托管字段须 raw 回填(已写明),否则测试无法构造旧会话。
