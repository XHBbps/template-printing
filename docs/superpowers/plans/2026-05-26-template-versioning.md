# 模板版本（草稿 / 发布 / 回滚 / 版本化渲染）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把模板"版本"从写死的空壳改造成真实能力——一份可变草稿 + N 个不可变已发布快照，支持发布/回滚、版本化渲染（API 可指定 version）、编辑器内版本管理弹窗。

**Architecture:** 草稿继续存 `Template.data`（autosave PATCH）；发布把草稿快照成 `TemplateVersion` 一行（version 自增）。"当前已发布版" = `max(version)`，存冗余列 `Template.publishedVersion`。外部 API / 飞书渲染锁定到某个已发布版（默认最新），把版本号写进 `RenderJob.templateVersion`，worker 据此加载对应快照；编辑器"预览/立即打印"是客户端 `window.print()`，天然渲染草稿，无需后端改动。

**Tech Stack:** NestJS + Prisma(PostgreSQL) + zod（apps/api）；bullmq worker + pg（apps/render）；Vue 3 + Pinia + Element Plus（apps/web）。

**验证约定（本项目既有方式，非单测框架）：**
- 后端：`docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit"` + 登录拿 cookie/csrf 后 `curl --noproxy '*' http://localhost:5173/api/...` 实测。
- 前端：`docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json"` + Playwright（chromium-1208）实测。
- 改后端代码后需 `docker restart template_printing-api-1`（nest --watch 看不到 Windows bind-mount 变更）；前端 vite HMR 自动生效。
- 登录态获取（验证脚本通用前缀）：
  ```bash
  cd /tmp && rm -f cj.txt
  LOGIN=$(curl -s --noproxy '*' -c cj.txt -X POST http://localhost:5173/api/auth/local/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
  CSRF=$(echo "$LOGIN" | sed -n 's/.*"csrf":"\([^"]*\)".*/\1/p')
  # 之后：curl --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" ...
  ```

---

## Phase A — 数据模型与迁移

### Task A1: Prisma schema 增量变更 + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（Template、RenderJob，新增 TemplateVersion）

- [ ] **Step 1: 改 `Template` model**，在 `updatedAt` 行后、`renderJobs` 关系前加两列，并加 versions 关系：

```prisma
model Template {
  id                    String   @id @default(uuid())
  name                  String
  description           String?
  data                  Json
  ownerId               String   @map("owner_id")
  owner                 User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  publishedVersion      Int?     @map("published_version")
  hasUnpublishedChanges Boolean  @default(false) @map("has_unpublished_changes")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  renderJobs RenderJob[]
  versions   TemplateVersion[]

  @@index([ownerId, updatedAt(sort: Desc)])
  @@map("templates")
}
```

- [ ] **Step 2: 在 `Template` model 之后新增 `TemplateVersion` model：**

```prisma
model TemplateVersion {
  id           String   @id @default(uuid())
  templateId   String   @map("template_id")
  template     Template @relation(fields: [templateId], references: [id], onDelete: Cascade)
  version      Int
  data         Json
  publishedAt  DateTime @default(now()) @map("published_at")
  publishedBy  String?  @map("published_by")
  restoredFrom Int?     @map("restored_from")

  @@unique([templateId, version])
  @@index([templateId, version(sort: Desc)])
  @@map("template_versions")
}
```

- [ ] **Step 3: 改 `RenderJob` model**，在 `cleanedAt` 行附近加一列：

```prisma
  templateVersion Int?      @map("template_version")
```

- [ ] **Step 4: 生成并应用迁移**（容器内，禁用 reset/accept-data-loss）：

Run:
```bash
docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec prisma migrate dev --name template_versioning --create-only"
```
然后检查生成的 SQL 仅为 `CREATE TABLE template_versions` + `ALTER TABLE templates ADD COLUMN ...` + `ALTER TABLE render_jobs ADD COLUMN ...`（纯增量，无 DROP / 无数据丢失）。确认后应用：
```bash
docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec prisma migrate deploy && pnpm exec prisma generate"
```
Expected: 迁移成功，`template_versions` 表创建，Prisma client 重新生成。

- [ ] **Step 5: 重启 api 让新 client 生效**

Run: `docker restart template_printing-api-1`
Expected: 容器重启，日志 `Nest application successfully started`。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): 模板版本表 + Template/RenderJob 版本列（增量迁移）"
```

### Task A2: 清空存量开发模板（一次性，不入 migration）

**Files:** 无（直接对 dev DB 操作）

- [ ] **Step 1: 清空 templates（级联删除 render_jobs / template_versions 等）**

Run:
```bash
docker exec template_printing-postgres-1 psql -U postgres -d template_printing -c "DELETE FROM templates;"
```
Expected: `DELETE N`（N=现有模板数）。级联清掉关联 render_jobs / lark 记录。

- [ ] **Step 2: 验证空表 + 新列存在**

Run:
```bash
docker exec template_printing-postgres-1 psql -U postgres -d template_printing -c "SELECT count(*) FROM templates; SELECT column_name FROM information_schema.columns WHERE table_name='templates' AND column_name IN ('published_version','has_unpublished_changes');"
```
Expected: count = 0；两列均列出。

（无 commit —— 纯 dev 数据操作。）

---

## Phase B — 发布 / 版本列表 / 回滚（apps/api）

### Task B1: `TemplatesService.publish()` + `POST /templates/:id/publish`

**Files:**
- Modify: `apps/api/src/templates/templates.service.ts`
- Modify: `apps/api/src/templates/templates.controller.ts`

- [ ] **Step 1: service 加 `publish()`**（在 `create()` 之后、`update()` 之前插入）：

```ts
  /** 把当前草稿(data)发布成新版本：version = max+1，事务内完成。 */
  async publish(ownerId: string, id: string): Promise<{ version: number; publishedAt: Date }> {
    const tpl = await this.prisma.template.findFirst({ where: { id, ownerId } });
    if (!tpl) throw new NotFoundException('template_not_found');

    return this.prisma.$transaction(async (tx) => {
      const max = await tx.templateVersion.aggregate({
        where: { templateId: id },
        _max: { version: true },
      });
      const nextVersion = (max._max.version ?? 0) + 1;
      const created = await tx.templateVersion.create({
        data: {
          templateId: id,
          version: nextVersion,
          data: tpl.data as object,
          publishedBy: ownerId,
        },
      });
      await tx.template.update({
        where: { id },
        data: { publishedVersion: nextVersion, hasUnpublishedChanges: false },
      });
      return { version: created.version, publishedAt: created.publishedAt };
    });
  }
```

- [ ] **Step 2: controller 加 publish 路由 + 审计**（在 `update` 方法之后、`remove` 之前）：

```ts
  @Post(':id/publish')
  async publish(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Req() req: Request) {
    const result = await this.svc.publish(me.sub, id);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.publish',
      resourceType: 'template',
      resourceId: id,
      details: { version: result.version },
      request: req,
    });
    return result;
  }
```

- [ ] **Step 3: typecheck + 重启**

Run:
```bash
docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api-1
```
Expected: `EXIT=0`，重启成功。

- [ ] **Step 4: curl 验证 publish**（用顶部登录前缀拿 cj.txt + CSRF；先建一个模板）：

```bash
cd /tmp
TID=$(curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/templates -d '{"name":"版本测试","data":{"meta":{"version":1,"name":"版本测试"},"canvas":{"cell":{"w":4,"h":4}},"elements":[],"schema":{}}}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
echo "tid=$TID"
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -X POST "http://localhost:5173/api/templates/$TID/publish" -w '\n[HTTP %{http_code}]\n'
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -X POST "http://localhost:5173/api/templates/$TID/publish" -w '\n[HTTP %{http_code}]\n'
```
Expected: 第一次返回 `{"version":1,...}`，第二次 `{"version":2,...}`（自增）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/templates/templates.service.ts apps/api/src/templates/templates.controller.ts
git commit -m "feat(api): 模板发布 POST /templates/:id/publish（草稿快照成版本）"
```

### Task B2: 版本列表 + 单版本快照接口

**Files:**
- Modify: `apps/api/src/templates/templates.service.ts`
- Modify: `apps/api/src/templates/templates.controller.ts`

- [ ] **Step 1: service 加 `listVersions()` 和 `getVersion()`**（接 `publish()` 之后）：

```ts
  async listVersions(ownerId: string, id: string) {
    const tpl = await this.prisma.template.findFirst({
      where: { id, ownerId },
      select: { publishedVersion: true, hasUnpublishedChanges: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');
    const versions = await this.prisma.templateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: 'desc' },
      select: { version: true, publishedAt: true, publishedBy: true, restoredFrom: true },
    });
    return {
      publishedVersion: tpl.publishedVersion,
      hasUnpublishedChanges: tpl.hasUnpublishedChanges,
      items: versions.map((v) => ({ ...v, isCurrent: v.version === tpl.publishedVersion })),
    };
  }

  async getVersion(ownerId: string, id: string, version: number) {
    const tpl = await this.prisma.template.findFirst({ where: { id, ownerId }, select: { id: true } });
    if (!tpl) throw new NotFoundException('template_not_found');
    const row = await this.prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId: id, version } },
    });
    if (!row) throw new NotFoundException('template_version_not_found');
    return { version: row.version, publishedAt: row.publishedAt, data: row.data };
  }
```

- [ ] **Step 2: controller 加两个 GET 路由**（注意路由顺序：放在 `@Get(':id')` 之前，避免 `:id` 吞掉 `versions`）：

```ts
  @Get(':id/versions')
  async listVersions(@CurrentUser() me: JwtClaims, @Param('id') id: string) {
    return this.svc.listVersions(me.sub, id);
  }

  @Get(':id/versions/:version')
  async getVersion(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    const v = Number(version);
    if (!Number.isInteger(v) || v < 1) throw new BadRequestException('invalid_version');
    return this.svc.getVersion(me.sub, id, v);
  }
```

- [ ] **Step 3: typecheck + 重启**

Run: `docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api-1`
Expected: `EXIT=0`。

- [ ] **Step 4: curl 验证**（沿用 Task B1 的 $TID，已发布 V1/V2）：

```bash
curl -s --noproxy '*' -b cj.txt "http://localhost:5173/api/templates/$TID/versions" -w '\n[HTTP %{http_code}]\n'
curl -s --noproxy '*' -b cj.txt "http://localhost:5173/api/templates/$TID/versions/1" -o /dev/null -w '[HTTP %{http_code}]\n'
curl -s --noproxy '*' -b cj.txt "http://localhost:5173/api/templates/$TID/versions/99" -o /dev/null -w '[HTTP %{http_code}]\n'
```
Expected: 列表含 V2/V1（V2 `isCurrent:true`）；version 1 → 200；version 99 → 404。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/templates/templates.service.ts apps/api/src/templates/templates.controller.ts
git commit -m "feat(api): 版本列表 + 单版本快照接口"
```

### Task B3: 一键回滚并发布

**Files:**
- Modify: `apps/api/src/templates/templates.service.ts`
- Modify: `apps/api/src/templates/templates.controller.ts`

- [ ] **Step 1: service 加 `rollback()`**（接 `getVersion()` 之后）：

```ts
  /** 一键回滚并发布：把 Vk 内容追加为新版 V(n+1)，restoredFrom=k；不改草稿。 */
  async rollback(
    ownerId: string,
    id: string,
    fromVersion: number,
  ): Promise<{ version: number; restoredFrom: number }> {
    const tpl = await this.prisma.template.findFirst({ where: { id, ownerId }, select: { id: true } });
    if (!tpl) throw new NotFoundException('template_not_found');
    return this.prisma.$transaction(async (tx) => {
      const src = await tx.templateVersion.findUnique({
        where: { templateId_version: { templateId: id, version: fromVersion } },
      });
      if (!src) throw new NotFoundException('template_version_not_found');
      const max = await tx.templateVersion.aggregate({
        where: { templateId: id },
        _max: { version: true },
      });
      const nextVersion = (max._max.version ?? 0) + 1;
      const created = await tx.templateVersion.create({
        data: {
          templateId: id,
          version: nextVersion,
          data: src.data as object,
          publishedBy: ownerId,
          restoredFrom: fromVersion,
        },
      });
      // 草稿未变 → 新发布版与草稿可能不一致，标记有未发布改动
      await tx.template.update({
        where: { id },
        data: { publishedVersion: nextVersion, hasUnpublishedChanges: true },
      });
      return { version: created.version, restoredFrom: fromVersion };
    });
  }
```

- [ ] **Step 2: controller 加 rollback 路由 + 审计**（接 publish 路由之后）：

```ts
  @Post(':id/rollback')
  async rollback(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const parsed = z.object({ version: z.coerce.number().int().min(1) }).safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.svc.rollback(me.sub, id, parsed.data.version);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.rollback',
      resourceType: 'template',
      resourceId: id,
      details: { version: result.version, restoredFrom: result.restoredFrom },
      request: req,
    });
    return result;
  }
```

- [ ] **Step 3: typecheck + 重启**

Run: `docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api-1`
Expected: `EXIT=0`。

- [ ] **Step 4: curl 验证回滚**（$TID 现有 V1/V2，回滚到 V1 应得 V3 且 restoredFrom=1）：

```bash
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST "http://localhost:5173/api/templates/$TID/rollback" -d '{"version":1}' -w '\n[HTTP %{http_code}]\n'
```
Expected: `{"version":3,"restoredFrom":1}`。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/templates/templates.service.ts apps/api/src/templates/templates.controller.ts
git commit -m "feat(api): 一键回滚并发布 POST /templates/:id/rollback"
```

### Task B4: 草稿改动标记 + 列表返回版本字段

**Files:**
- Modify: `apps/api/src/templates/templates.service.ts`（`update()`、`list()` 的 select）

- [ ] **Step 1: `update()` 在 data 变更时置 `hasUnpublishedChanges=true`。** 改 `update()` 的 data 块：

```ts
    return this.prisma.template.update({
      where: { id },
      data: {
        ...(payload.name !== undefined && { name: payload.name }),
        ...(payload.description !== undefined && { description: payload.description }),
        ...(payload.data !== undefined && { data: payload.data as object, hasUnpublishedChanges: true }),
      },
    });
```

- [ ] **Step 2: `list()` 的 `select` 增加两列：**

```ts
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          publishedVersion: true,
          hasUnpublishedChanges: true,
        },
```

- [ ] **Step 3: typecheck + 重启**

Run: `docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api-1`
Expected: `EXIT=0`。

- [ ] **Step 4: curl 验证**（list 返回新字段；PATCH 后 hasUnpublishedChanges=true）：

```bash
curl -s --noproxy '*' -b cj.txt "http://localhost:5173/api/templates?limit=3" | python3 -c "import sys,json;[print(i['name'],i.get('publishedVersion'),i.get('hasUnpublishedChanges')) for i in json.load(sys.stdin)['items']]"
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X PATCH "http://localhost:5173/api/templates/$TID" -d '{"data":{"meta":{"version":1,"name":"版本测试"},"canvas":{"cell":{"w":4,"h":4}},"elements":[],"schema":{}}}' -o /dev/null -w '[PATCH %{http_code}]\n'
curl -s --noproxy '*' -b cj.txt "http://localhost:5173/api/templates/$TID/versions" | python3 -c "import sys,json;d=json.load(sys.stdin);print('hasUnpublishedChanges=',d['hasUnpublishedChanges'])"
```
Expected: list 项含 publishedVersion/hasUnpublishedChanges；PATCH 后该模板 `hasUnpublishedChanges=true`。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/templates/templates.service.ts
git commit -m "feat(api): 草稿改动标记 hasUnpublishedChanges + 列表返回版本字段"
```

---

## Phase C — 版本化渲染（apps/api + apps/render）

### Task C1: render enqueue 接受 version + 解析 + 落 RenderJob.templateVersion

**Files:**
- Modify: `apps/api/src/render/render.controller.ts`（EnqueueDto）
- Modify: `apps/api/src/render/render.service.ts`（EnqueueArgs + enqueue + get）

- [ ] **Step 1: EnqueueDto 加可选 version：**

```ts
const EnqueueDto = z.object({
  templateId: z.string().min(1),
  data: z.record(z.unknown()).default({}),
  formats: z.array(z.enum(['pdf', 'png'])).optional(),
  callbackUrl: z.string().url().optional(),
  version: z.coerce.number().int().min(1).optional(),
});
```

- [ ] **Step 2: `EnqueueArgs` 接口加 `version?: number`：**

```ts
export interface EnqueueArgs {
  templateId: string;
  data: Record<string, unknown>;
  formats?: ('pdf' | 'png')[];
  callbackUrl?: string;
  version?: number;
}
```

- [ ] **Step 3: `enqueue()` 解析版本并落库。** 替换 enqueue 开头的 template 校验块到 job 创建之间：

```ts
    const where = ownerId ? { id: args.templateId, ownerId } : { id: args.templateId };
    const tpl = await this.prisma.template.findFirst({
      where,
      select: { id: true, publishedVersion: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');

    // 解析渲染版本：传了用指定版本，否则用最新已发布版
    let resolvedVersion: number;
    if (args.version != null) {
      const ver = await this.prisma.templateVersion.findUnique({
        where: { templateId_version: { templateId: args.templateId, version: args.version } },
        select: { version: true },
      });
      if (!ver) throw new NotFoundException('template_version_not_found');
      resolvedVersion = ver.version;
    } else {
      if (tpl.publishedVersion == null) {
        throw new BadRequestException('no_published_version');
      }
      resolvedVersion = tpl.publishedVersion;
    }

    if (ownerId) {
      await this.checkDailyQuota(ownerId);
    }

    const formats = args.formats?.length ? args.formats : (['pdf', 'png'] as const);
    const job = await this.prisma.renderJob.create({
      data: {
        templateId: args.templateId,
        data: args.data as object,
        formats: [...formats],
        status: 'pending',
        callbackUrl: args.callbackUrl ?? null,
        templateVersion: resolvedVersion,
      },
    });
```
（同时给 service 顶部 import 补 `BadRequestException`：`import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';`）

- [ ] **Step 4: controller `enqueue` 把 version 透传**（`this.svc.enqueue(me.sub, parsed.data)` 已含 version，因 parsed.data 现含 version，无需改）。确认 `EnqueueArgs` 匹配即可。

- [ ] **Step 5: `get()` 返回 templateVersion。** 在 `get()` 的返回类型与对象里加 `templateVersion: number | null`：

```ts
    return {
      jobId: job.id,
      status: job.status,
      pdfUrl: this.fileSig.signUrl(job.pdfUrl),
      pngUrl: this.fileSig.signUrl(job.pngUrl),
      errorMsg: job.errorMsg,
      templateVersion: job.templateVersion,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      cleanedAt: job.cleanedAt,
    };
```
（同步把方法返回类型签名加 `templateVersion: number | null;`，controller `get()` 的返回类型签名也加同一行。）

- [ ] **Step 6: typecheck + 重启**

Run: `docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api-1`
Expected: `EXIT=0`。

- [ ] **Step 7: curl 验证版本解析**（$TID 已有已发布版）：

```bash
# 默认（最新已发布版）
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/render -d "{\"templateId\":\"$TID\",\"formats\":[\"pdf\"]}" -w '\n[HTTP %{http_code}]\n'
# 指定不存在版本 → 404
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/render -d "{\"templateId\":\"$TID\",\"version\":99}" -o /dev/null -w '[HTTP %{http_code}]\n'
# 未发布模板 → 400 no_published_version（新建一个不发布的）
NID=$(curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/templates -d '{"name":"未发布","data":{"meta":{"version":1,"name":"未发布"},"canvas":{"cell":{"w":4,"h":4}},"elements":[],"schema":{}}}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/render -d "{\"templateId\":\"$NID\"}" -o /dev/null -w '[HTTP %{http_code}]\n'
```
Expected: 默认 → 200 + jobId；version 99 → 404；未发布 → 400。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/render/render.controller.ts apps/api/src/render/render.service.ts
git commit -m "feat(api): 渲染支持 version 入参（默认最新已发布版）+ 落 RenderJob.templateVersion"
```

### Task C2: 飞书 webhook 透传 version

**Files:**
- Modify: `apps/api/src/lark/lark-bitable.controller.ts`（DTO + enqueue 调用）

- [ ] **Step 1: 找到 bitable 的请求体 zod DTO**（含 templateId/data/lark.* 字段），加可选 `version: z.coerce.number().int().min(1).optional()`。

- [ ] **Step 2: enqueue 调用透传 version。** 在 `this.render.enqueue(null, { templateId: dto.templateId, data: dto.data, ... })` 里加 `version: dto.version`。

- [ ] **Step 3: typecheck + 重启**

Run: `docker exec template_printing-api-1 sh -c "cd /workspace/apps/api && pnpm exec tsc --noEmit; echo EXIT=\$?" && docker restart template_printing-api-1`
Expected: `EXIT=0`。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lark/lark-bitable.controller.ts
git commit -m "feat(api): 飞书 print-trigger 透传 version"
```

### Task C3: render worker 按 templateVersion 加载快照

**Files:**
- Modify: `apps/render/src/db.ts`（JobRow 加 template_version；fetchJob select；新增 fetchTemplateVersion）
- Modify: `apps/render/src/main.ts`（按 version 选数据源）

- [ ] **Step 1: `JobRow` 接口加字段：**

```ts
export interface JobRow {
  id: string;
  template_id: string;
  template_version: number | null;
  data: Record<string, unknown>;
  formats: string[];
  status: string;
  pdf_url: string | null;
  png_url: string | null;
  error_msg: string | null;
  callback_url: string | null;
}
```

- [ ] **Step 2: `fetchJob` SQL select 加 `template_version`：**

```ts
  const r = await pool.query<JobRow>(
    'SELECT id, template_id, template_version, data, formats, status, pdf_url, png_url, error_msg, callback_url FROM render_jobs WHERE id = $1',
    [id],
  );
```

- [ ] **Step 3: 新增 `fetchTemplateVersion`（接 `fetchTemplate` 之后）：**

```ts
export async function fetchTemplateVersion(
  templateId: string,
  version: number,
): Promise<TemplateRow | null> {
  const r = await pool.query<TemplateRow>(
    "SELECT t.id, t.name, tv.data FROM template_versions tv JOIN templates t ON t.id = tv.template_id WHERE tv.template_id = $1 AND tv.version = $2",
    [templateId, version],
  );
  return r.rows[0] ?? null;
}
```

- [ ] **Step 4: `main.ts` 按 templateVersion 选数据源。** 改 import 加 `fetchTemplateVersion`，并替换 `const tpl = await fetchTemplate(job.template_id);` 块：

```ts
      const tpl =
        job.template_version != null
          ? await fetchTemplateVersion(job.template_id, job.template_version)
          : await fetchTemplate(job.template_id);
      if (!tpl) {
        await markFailed(jobId, 'template_not_found', attemptNo);
        await sendCallback(jobId, job.callback_url);
        throw new UnrecoverableError('template_not_found');
      }
```

- [ ] **Step 5: typecheck render**

Run: `docker exec template_printing-render-1 sh -c "cd /workspace/apps/render && pnpm exec tsc --noEmit; echo EXIT=\$?"`
Expected: `EXIT=0`。（render 容器可能无 tsc 脚本——若失败改用 `docker exec template_printing-api-1` 跑根 `pnpm -C apps/render exec tsc --noEmit`，或全仓 `pnpm typecheck`。）

- [ ] **Step 6: 重启 render worker + 端到端验证**

Run: `docker restart template_printing-render-1`
然后用 Task C1 的 $TID 发一个默认渲染，轮询 job 状态直到 done，确认 `templateVersion` 在 `GET /api/render/:jobId` 返回里有值：
```bash
JOB=$(curl -s --noproxy '*' -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/render -d "{\"templateId\":\"$TID\",\"formats\":[\"pdf\"]}" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')
sleep 4
curl -s --noproxy '*' -b cj.txt "http://localhost:5173/api/render/$JOB" | python3 -c "import sys,json;d=json.load(sys.stdin);print('status=',d['status'],'templateVersion=',d.get('templateVersion'))"
```
Expected: `status= done templateVersion= <n>`（非 null）。

- [ ] **Step 7: Commit**

```bash
git add apps/render/src/db.ts apps/render/src/main.ts
git commit -m "feat(render): worker 按 RenderJob.templateVersion 加载对应版本快照"
```

---

## Phase D — 前端（apps/web）

### Task D1: templates store 列表项类型加版本字段

**Files:**
- Modify: `apps/web/src/stores/templates.ts`（`TemplateListItem`）

- [ ] **Step 1: `TemplateListItem` 加两字段：**

```ts
export interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
}
```

- [ ] **Step 2: typecheck**

Run: `docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/templates.ts
git commit -m "feat(web): 模板列表项类型加 publishedVersion/hasUnpublishedChanges"
```

### Task D2: designer store 加发布动作 + 版本状态

**Files:**
- Modify: `apps/web/src/stores/designer.ts`（state + actions）

- [ ] **Step 1: state 加版本字段**（在 `saveError` 之后）：

```ts
    saveError: null as string | null,
    publishedVersion: null as number | null,
    hasUnpublishedChanges: false,
```

- [ ] **Step 2: `setTemplateId` 不动；新增 `setVersionState` + `publish` action**（接 `saveToBackend` 之后）：

```ts
    setVersionState(publishedVersion: number | null, hasUnpublishedChanges: boolean): void {
      this.publishedVersion = publishedVersion;
      this.hasUnpublishedChanges = hasUnpublishedChanges;
    },
    async publish(): Promise<{ version: number } | null> {
      if (!this.templateId) return null;
      // 发布前确保草稿已落库（autosave 可能还在 debounce 中）
      if (this.saveStatus === 'pending' || this.dirty) {
        await this.saveToBackend();
      }
      const { apiFetch } = await import('../lib/api');
      const r = await apiFetch<{ version: number; publishedAt: string }>(
        `/templates/${this.templateId}/publish`,
        { method: 'POST' },
      );
      this.publishedVersion = r.version;
      this.hasUnpublishedChanges = false;
      return { version: r.version };
    },
```

- [ ] **Step 3: `saveToBackend` 成功后置 `hasUnpublishedChanges = true`**（草稿已变 → 与已发布版不一致）。在 `this.dirty = false;` 后加：

```ts
        this.dirty = false;
        this.hasUnpublishedChanges = true;
```

- [ ] **Step 4: typecheck**

Run: `docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/designer.ts
git commit -m "feat(web): designer store 发布动作 + 版本状态"
```

### Task D3: DesignerView 载入版本状态 + DesignerHeader「发布」按钮 + 左面板真实状态

**Files:**
- Modify: `apps/web/src/views/DesignerView.vue`（loadById 读版本字段；saveCaption 改真实状态）
- Modify: `apps/web/src/designer/DesignerHeader.vue`（保存→发布）

- [ ] **Step 1: `DesignerView.loadById` 读版本字段并写入 store。** 把 `apiFetch` 的泛型与赋值改为：

```ts
    const record = await apiFetch<{
      id: string;
      name: string;
      data: unknown;
      publishedVersion: number | null;
      hasUnpublishedChanges: boolean;
    }>(`/templates/${id}`);
```
并在 `store.setTemplateId(id);` 之后加：

```ts
    store.setVersionState(record.publishedVersion, record.hasUnpublishedChanges);
```

- [ ] **Step 2: `saveCaption` 改为反映真实版本状态。** 替换为：

```ts
const saveCaption = computed<{ cap: string; han: string }>(() => {
  if (store.saveStatus === 'saving') return { cap: 'SAVING', han: '保存中…' };
  if (store.saveStatus === 'error') return { cap: 'SAVE FAILED', han: '保存失败' };
  if (store.publishedVersion == null) return { cap: 'UNPUBLISHED', han: '未发布' };
  if (store.hasUnpublishedChanges)
    return { cap: `V${store.publishedVersion} · UNPUBLISHED CHANGES`, han: `V${store.publishedVersion} · 有未发布改动` };
  return { cap: `V${store.publishedVersion} · PUBLISHED`, han: `V${store.publishedVersion} · 已发布` };
});
```

- [ ] **Step 3: DesignerHeader 把「保存」按钮换成「发布」。** 替换 `.tt-btn-secondary` 那个 button：

```vue
    <button
      class="tt-btn-secondary"
      type="button"
      :disabled="publishing || (store.publishedVersion != null && !store.hasUnpublishedChanges)"
      @click="doPublish"
    >
      <Save :size="14" :stroke-width="1.5" />
      {{ publishing ? '发布中…' : '发布' }}
    </button>
```
并在 `<script setup>` 加（import ElMessage 已有则复用；DesignerHeader 目前没 import ElMessage，需加 `import { ElMessage } from 'element-plus';`）：

```ts
const publishing = ref(false);
async function doPublish(): Promise<void> {
  publishing.value = true;
  try {
    const r = await store.publish();
    if (r) ElMessage.success(`已发布 V${r.version}`);
  } catch (e) {
    ElMessage.error(`发布失败：${(e as Error).message}`);
  } finally {
    publishing.value = false;
  }
}
```

- [ ] **Step 4: typecheck**

Run: `docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 5: Playwright 验证**（登录→模板中心→新建→编辑器出现「发布」按钮，点发布后左面板显示「V1 · 已发布」，发布按钮置灰；改动后变「V1 · 有未发布改动」、按钮可用）。脚本参照 session 既有 Playwright 模式（chromium-1208 executablePath + `--no-proxy-server`）。
Expected: 上述状态流转正确。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/DesignerView.vue apps/web/src/designer/DesignerHeader.vue
git commit -m "feat(web): 设计器保存按钮改发布 + 真实版本状态徽章"
```

### Task D4: 模板中心列表徽章 + 面包屑可点开版本弹窗

**Files:**
- Modify: `apps/web/src/views/TemplatesView.vue`

- [ ] **Step 1: 替换两处写死的 `<span>V1 DRAFT</span>`**（grid 约 431 行、list 约 463 行）为真实状态徽章。新增一个 helper（`<script setup>` 内）：

```ts
function versionLabel(t: TemplateListItem): string {
  if (t.publishedVersion == null) return '未发布';
  return t.hasUnpublishedChanges ? `V${t.publishedVersion} · 有改动` : `V${t.publishedVersion}`;
}
```
两处 `<span>V1 DRAFT</span>` → `<span>{{ versionLabel(t) }}</span>`。

- [ ] **Step 2: 面包屑模板名改为可点击打开版本弹窗。** 把 editor 模式的 `.tv-bc-current` 改为按钮式可点击：

```vue
        <button class="tv-bc-current tv-bc-current--btn" type="button" @click="versionDialogOpen = true">
          {{ currentTemplateName }}
        </button>
```
新增 state `const versionDialogOpen = ref(false);` 和样式（`.tv-bc-current--btn { background:none; border:none; cursor:pointer; font: inherit; color: var(--ink); font-weight:500; }` hover 加红下划线）。

- [ ] **Step 3: 引入并挂载 VersionDialog**（组件在 Task D5 创建）。import + 在编辑器模式模板末尾加：

```vue
    <VersionDialog
      v-if="currentId"
      v-model="versionDialogOpen"
      :template-id="currentId"
    />
```

- [ ] **Step 4: typecheck（D5 完成后一起过）**

- [ ] **Step 5: Commit**（与 D5 合并提交，见 D5 Step 末）

### Task D5: VersionDialog 组件（左版本列表 + 只读预览 + 一键回滚）

**Files:**
- Create: `apps/web/src/designer/VersionDialog.vue`

- [ ] **Step 1: 创建组件骨架**（ElDialog + 左 ElScrollbar 版本列表 + 右只读预览 + 回滚按钮）：

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElScrollbar, ElMessage } from 'element-plus';
import { apiFetch } from '../lib/api';
import { useDesignerStore } from '../stores/designer';

const props = defineProps<{ modelValue: boolean; templateId: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
const store = useDesignerStore();

interface VersionItem {
  version: number;
  publishedAt: string;
  restoredFrom: number | null;
  isCurrent: boolean;
}
const items = ref<VersionItem[]>([]);
const publishedVersion = ref<number | null>(null);
const selected = ref<number | null>(null);
const loading = ref(false);
const rolling = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await apiFetch<{
      publishedVersion: number | null;
      items: VersionItem[];
    }>(`/templates/${props.templateId}/versions`);
    items.value = r.items;
    publishedVersion.value = r.publishedVersion;
    selected.value = r.items[0]?.version ?? null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
  },
);

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function doRollback(version: number): Promise<void> {
  rolling.value = true;
  try {
    const r = await apiFetch<{ version: number; restoredFrom: number }>(
      `/templates/${props.templateId}/rollback`,
      { method: 'POST', body: JSON.stringify({ version }) },
    );
    ElMessage.success(`已回滚：V${r.restoredFrom} → 新版 V${r.version}`);
    store.setVersionState(r.version, true);
    await load();
  } catch (e) {
    ElMessage.error(`回滚失败：${(e as Error).message}`);
  } finally {
    rolling.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    title="版本管理"
    width="720px"
    :append-to-body="true"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="vd-body">
      <ElScrollbar class="vd-list" max-height="420px">
        <button
          v-for="v in items"
          :key="v.version"
          class="vd-item"
          :class="{ active: selected === v.version }"
          type="button"
          @click="selected = v.version"
        >
          <span class="vd-ver">V{{ v.version }}</span>
          <span v-if="v.isCurrent" class="vd-cur">当前</span>
          <span v-if="v.restoredFrom != null" class="vd-from">← 回滚自 V{{ v.restoredFrom }}</span>
          <span class="vd-time">{{ fmt(v.publishedAt) }}</span>
        </button>
        <div v-if="!loading && items.length === 0" class="vd-empty">尚无已发布版本</div>
      </ElScrollbar>

      <div class="vd-detail">
        <template v-if="selected != null">
          <div class="vd-detail-head">版本 V{{ selected }}</div>
          <button
            v-if="publishedVersion != null && selected !== publishedVersion"
            class="vd-rollback"
            type="button"
            :disabled="rolling"
            @click="doRollback(selected)"
          >
            {{ rolling ? '回滚中…' : `回滚并发布（基于 V${selected}）` }}
          </button>
          <p v-else class="vd-note">这是当前发布版本。</p>
        </template>
      </div>
    </div>
  </ElDialog>
</template>

<style scoped>
.vd-body { display: grid; grid-template-columns: 240px 1fr; gap: 20px; }
.vd-list { border-right: 1px solid var(--stone); padding-right: 8px; }
.vd-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 12px; border: none; background: none; cursor: pointer;
  border-left: 2px solid transparent; font-family: var(--font-han); text-align: left;
}
.vd-item:hover { background: var(--mist); }
.vd-item.active { border-left-color: var(--yangli-red); background: var(--mist); }
.vd-ver { font-family: var(--font-mono); font-weight: 600; color: var(--ink); }
.vd-cur { font-family: var(--font-mono); font-size: 10px; color: var(--yangli-red); }
.vd-from { font-family: var(--font-mono); font-size: 10px; color: var(--fg-3); }
.vd-time { margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-3); }
.vd-empty { padding: 24px; text-align: center; color: var(--fg-3); font-family: var(--font-han); }
.vd-detail-head { font-family: var(--font-han); font-weight: 600; font-size: 15px; color: var(--ink); margin-bottom: 14px; }
.vd-rollback {
  height: 38px; padding: 0 18px; background: var(--yangli-red); color: var(--paper-white);
  border: 1px solid var(--yangli-red); border-radius: var(--radius-2); cursor: pointer;
  font-family: var(--font-han); font-size: 13px; font-weight: 500;
}
.vd-rollback:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.vd-rollback:disabled { opacity: 0.5; cursor: not-allowed; }
.vd-note { font-family: var(--font-han); font-size: 13px; color: var(--fg-3); }
</style>
```

> 注：本 Task 先做版本列表 + 回滚（右侧仅元信息 + 回滚按钮）。右侧**只读快照预览**在 Task D6 加上（复用 `TemplateRenderer`）。

- [ ] **Step 2: typecheck**

Run: `docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 3: Playwright 验证**（编辑器点面包屑模板名 → 弹窗出现，列表显示已发布版本，选中旧版点「回滚并发布」→ 列表顶部出现新版且标"当前"、新版含"← 回滚自 Vk"）。
Expected: 回滚后新版成为当前发布版。

- [ ] **Step 4: Commit（D4 + D5 合并）**

```bash
git add apps/web/src/views/TemplatesView.vue apps/web/src/designer/VersionDialog.vue
git commit -m "feat(web): 模板中心版本徽章 + 面包屑版本管理弹窗（含一键回滚）"
```

### Task D6: 版本弹窗右侧只读快照预览（复用 TemplateRenderer）

**Files:**
- Modify: `apps/web/src/designer/VersionDialog.vue`

- [ ] **Step 1: 引入渲染器与类型。** 在 `<script setup>` import 区加：

```ts
// eslint-disable-next-line import/no-unresolved
import { TemplateRenderer } from '@template-printing/template-renderer';
import type { Template } from '@template-printing/schema';
```

- [ ] **Step 2: 加快照预览状态 + 加载逻辑。** 在 `const rolling = ref(false);` 之后加：

```ts
const snapshotTpl = ref<Template | null>(null);
const sampleData = ref<Record<string, unknown>>({});
const previewLoading = ref(false);

const PANE_W = 420;
const PANE_H = 360;
const previewScale = computed(() => {
  const t = snapshotTpl.value;
  if (!t) return 1;
  const canvasW = t.canvas.cell.w * t.canvas.cols;
  const canvasH = t.canvas.cell.h * t.canvas.rows;
  if (!canvasW || !canvasH) return 1;
  return Math.max(0.1, Math.min(PANE_W / canvasW, PANE_H / canvasH, 1));
});

async function loadSnapshot(version: number): Promise<void> {
  previewLoading.value = true;
  snapshotTpl.value = null;
  try {
    const r = await apiFetch<{ version: number; data: Template }>(
      `/templates/${props.templateId}/versions/${version}`,
    );
    snapshotTpl.value = r.data;
    const sample: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(r.data.schema ?? {})) {
      sample[key] = (def as { example?: unknown }).example ?? '';
    }
    sampleData.value = sample;
  } finally {
    previewLoading.value = false;
  }
}
```
并把 import 行的 `ref` 补上 `computed`：`import { ref, computed, watch } from 'vue';`

- [ ] **Step 3: 选中版本时加载快照。** 加一个 watch（接现有 `watch(() => props.modelValue, ...)` 之后）：

```ts
watch(selected, (v) => {
  if (v != null) void loadSnapshot(v);
});
```

- [ ] **Step 4: 右栏模板加预览区。** 在 `.vd-detail` 内 `<div class="vd-detail-head">` 之后、回滚按钮之前插入：

```vue
          <div class="vd-preview">
            <div v-if="previewLoading" class="vd-preview-empty">加载中…</div>
            <div
              v-else-if="snapshotTpl"
              class="vd-preview-scale"
              :style="{ transform: `scale(${previewScale})` }"
            >
              <TemplateRenderer :template="snapshotTpl" :data="sampleData" />
            </div>
          </div>
```

- [ ] **Step 5: 加预览样式**（`<style scoped>` 内）：

```css
.vd-preview {
  width: 420px; height: 360px; margin-bottom: 16px;
  border: 1px solid var(--stone); background: var(--mist);
  overflow: hidden; display: flex; align-items: flex-start; justify-content: flex-start;
}
.vd-preview-scale { transform-origin: top left; background: var(--paper-white); }
.vd-preview-empty { margin: auto; color: var(--fg-3); font-family: var(--font-han); font-size: 13px; }
```

- [ ] **Step 6: typecheck**

Run: `docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 7: Playwright 验证**（打开版本弹窗 → 选不同版本，右侧只读预览随之渲染对应版本的画布；选当前版/旧版均能预览）。
Expected: 右侧预览正确反映所选版本快照。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/designer/VersionDialog.vue
git commit -m "feat(web): 版本弹窗右侧只读快照预览（复用 TemplateRenderer）"
```

---

## Phase E — API 文档页同步（ApiView v2）

### Task E1: ApiView endpoints[] 按 spec §3.5.1 更新

**Files:**
- Modify: `apps/web/src/views/ApiView.vue`（`endpoints` 数据 + 概览段）

- [ ] **Step 1: 概览段补一句。** 找到 `<section id="overview">` 内的 `<p>`，在句末追加：「渲染针对模板的**已发布版本**：默认最新已发布版，可在请求里指定 `version` 渲染历史版本。」

- [ ] **Step 2: `POST /api/render` 的 `reqRows` 加 version 行，并改 data 说明。** 在 `ep-enqueue` 的 `reqRows` 数组里：
  - 改 `data` 行 desc 为：`业务字段 map，key 对应该版本模板 schema.fields；默认 {}`
  - 末尾加：`{ code: 'version', type: 'number', req: false, desc: '指定渲染的已发布版本号；不传=最新已发布版' }`

- [ ] **Step 3: `ep-enqueue` 的 `errors` 加两条：**

```ts
      { http: '400', code: 'no_published_version', reason: '该模板尚无已发布版本（请先在设计器发布）' },
      { http: '404', code: 'template_version_not_found', reason: '指定的 version 不存在或不属于该模板' },
```
（保留原有 400 BAD_REQUEST / 401 / 404 template_not_found。）

- [ ] **Step 4: `ep-enqueue` 的 samples 至少一处体现 version。** 在 curl 示例 `-d` 的 JSON 里加 `,"version":2`（或在 node/python 体里加 `version: 2`），并可加注释说明可选。

- [ ] **Step 5: `ep-get-job` 的 `respRows` 加一行：**

```ts
      { code: 'templateVersion', type: 'number | null', desc: '本次渲染锁定的版本号（草稿渲染为 null）' },
```
并在 `respExample` JSON 里加 `"templateVersion": 2,`。

- [ ] **Step 6: `ep-lark-trigger` 的 `reqRows` 加 version 行：**

```ts
      { code: 'version', type: 'number', req: false, desc: '指定渲染的已发布版本号；不传=最新已发布版' },
```

- [ ] **Step 7: typecheck**

Run: `docker exec template_printing-web-1 sh -c "cd /workspace/apps/web && pnpm exec vue-tsc --noEmit -p tsconfig.json; echo EXIT=\$?"`
Expected: `EXIT=0`。

- [ ] **Step 8: Playwright 验证**（/api 文档 tab → POST /api/render 展开 → 请求栏有 version 行、错误栏有两条新码、示例含 version；GET jobId 响应栏有 templateVersion）。
Expected: 文档内容已同步。

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/views/ApiView.vue
git commit -m "docs(web): API 文档页同步 version 入参 / 错误码 / jobId templateVersion"
```

---

## Phase F — 文档同步（AGENTS.md 第 9 节触发映射）

### Task F1: PROGRESS.md 近期变更 + 相关文档

**Files:**
- Modify: `docs/PROGRESS.md`（顶部"最近更新"日期 + 第 3 节"近期变更"追加）
- Modify（按 AGENTS.md 第 9 节判断是否触发）：`README.md` / `docs/deployment.md` 若涉及（本特性新增 API 行为，README API 示例可补 version 说明）

- [ ] **Step 1: PROGRESS.md 顶部"最近更新"改为 2026-05-26（模板版本：草稿/发布/回滚/版本化渲染）。**

- [ ] **Step 2: 第 3 节"近期变更" 2026-05-26 下追加一条**，概述：草稿/发布模型、版本号、回滚、渲染 version 入参、版本弹窗、存量 dev 数据清空、相关接口与文件。

- [ ] **Step 3: 检查 README "API" 段是否有 `/api/render` 示例**；若有，补一句 version 可选参数说明（按 AGENTS.md 第 9 节"接口契约变更 → README/deployment"映射）。

- [ ] **Step 4: Commit**

```bash
git add docs/PROGRESS.md README.md
git commit -m "docs: 模板版本特性 — PROGRESS 近期变更 + README API version 说明"
```

---

## 自检清单（实施收尾前）

- [ ] `pnpm typecheck`（api + web + render）全绿
- [ ] 关键路径手测：新建→发布 V1→改→发布 V2→回滚 V1 得 V3；API 默认渲染最新版、指定 version 渲染对应版、未发布 400、坏版本 404；编辑器立即打印仍出草稿
- [ ] 没有提交 .env / storage / 测试输出
- [ ] commit 前缀规范（feat/fix/docs）
- [ ] AGENTS.md 第 9 节触发映射的 docs 已同步
