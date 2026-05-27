# 模板分享 / 公共模板库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模板新增 `private/public` 可见性;管理员可把已发布模板上架为公共;任意登录用户可浏览公共模板库并「复制到我的账号」(复制取最新发布版,成私有新草稿)。

**Architecture:** `Template` 加 `visibility` 列;后端 `templates` 模块新增 3 个**不带 ownerId 过滤**的方法/端点(`listPublic` / `setVisibility`(admin) / `copyFromPublic`),现有 owner 限定方法不动;前端 `TemplatesView` 加「我的/公共」tab + 公共库只读列表 + 「复制到我的」+ admin 「设为公开」开关。

**Tech Stack:** NestJS + Prisma(PostgreSQL)+ Vue3 Pinia + Element Plus;jest+supertest e2e。

**Spec:** `docs/superpowers/specs/2026-05-27-template-sharing-design.md`

**硬性约束(贯穿全程):**
- **约束 A**:`listPublic`/`setVisibility`/`copyFromPublic` 全新查询,**不带 ownerId、禁止复用 `get(ownerId,id)`**;`copyFromPublic` 源查询 `{ id, visibility:'public', publishedVersion:{not:null} }`(跨 owner)。
- **约束 B**:copy 取版本走 `publishedVersion` 列 + `templateId_version` 唯一键,**不用 max(version)**。

**全局约定:** 容器内跑命令:`docker exec template_printing-api sh -c "cd /workspace/apps/api && <cmd>"`(web 同理用 `template_printing-web`)。提交走 husky,不 `--no-verify`,只 `git add` 本任务文件。

---

## File Structure

- Modify `apps/api/prisma/schema.prisma` —— `Template` 加 `visibility` + 索引。
- Create `apps/api/prisma/migrations/<ts>_add_template_visibility/migration.sql` —— 迁移。
- Modify `apps/api/src/templates/templates.service.ts` —— 加 `listPublic`/`setVisibility`/`copyFromPublic`(不动现有方法)。
- Modify `apps/api/src/templates/templates.controller.ts` —— 加 `GET /public`(置 `:id` 前)、`PATCH :id/visibility`(@Roles)、`POST :id/copy`。
- Create `apps/api/test/template-sharing.e2e.spec.ts` —— e2e。
- Modify `apps/web/src/stores/templates.ts` —— 加 `fetchPublicSlice`/`setVisibility`/`copyFromPublic` + `PublicTemplateListItem` 类型。
- Modify `apps/web/src/views/TemplatesView.vue` —— tab + 公共库列表 + 复制 + admin 开关。
- Modify `docs/PROGRESS.md` + 视情况 `AGENTS.md`。

---

## Task 1: DB — Template.visibility 列 + 索引 + 迁移

**Files:** Modify `apps/api/prisma/schema.prisma`;Create migration。

- [ ] **Step 1: 改 schema**

In `apps/api/prisma/schema.prisma` 的 `model Template`,在 `hasUnpublishedChanges` 行后加 `visibility` 字段,并在 `@@index([ownerId, updatedAt(sort: Desc)])` 后加新索引:

```prisma
  hasUnpublishedChanges Boolean  @default(false) @map("has_unpublished_changes")
  visibility            String   @default("private")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  renderJobs RenderJob[]
  versions   TemplateVersion[]

  @@index([ownerId, updatedAt(sort: Desc)])
  @@index([visibility, updatedAt(sort: Desc)])
  @@map("templates")
```

- [ ] **Step 2: 生成并应用迁移(安全路径,绝不 reset)**

Run:
```
docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm exec prisma migrate dev --name add_template_visibility"
```
Expected: 新建 `prisma/migrations/<ts>_add_template_visibility/migration.sql` 并应用 + 重新生成 client。生成的 SQL 应等价于:
```sql
ALTER TABLE "templates" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';
CREATE INDEX "templates_visibility_updated_at_idx" ON "templates"("visibility", "updated_at" DESC);
```
**若 prisma 报 drift 并要 reset/清库:立即停手(状态 BLOCKED),不要 reset**(违反 CLAUDE.md)。改用 `--create-only` 生成迁移文件后 `pnpm exec prisma migrate deploy` 应用(deploy 永不 reset);仍异常则上报。

- [ ] **Step 3: 验证列存在**

Run:
```
docker exec template_printing-postgres psql -U postgres -d template_printing -tA -c "SELECT column_name,column_default FROM information_schema.columns WHERE table_name='templates' AND column_name='visibility';"
```
Expected: `visibility|'private'::text`(存量行均为 private)。

- [ ] **Step 4: typecheck(client 已含 visibility)**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck"` — Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): Template 加 visibility(private/public)+ [visibility,updatedAt] 索引"
```

---

## Task 2: 后端 — listPublic / setVisibility / copyFromPublic + 端点 + e2e

**Files:** Modify `templates.service.ts`、`templates.controller.ts`;Create `apps/api/test/template-sharing.e2e.spec.ts`。

- [ ] **Step 1: 写失败 e2e** `apps/api/test/template-sharing.e2e.spec.ts`:

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

describe('Template sharing e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_share_admin';
  const USERB = 'e2e_share_userb';
  const NONAME = 'e2e_share_noname';
  const PW = 'pw-e2e-share-1';
  let adminCookie: string;
  let userbCookie: string;
  let pubTplId: string; // admin 的已发布+公开模板
  let unpubTplId: string; // admin 的未发布模板
  let nonameTplId: string; // owner.name=null 的公开模板
  const VER_DATA = { id: 'v', meta: { name: 'x', description: '', version: 1, tags: [] }, canvas: { cols: 1, rows: 1, cell: { w: 1, h: 1 }, paper: 'A4', orientation: 'portrait', background: null }, schema: {}, elements: [] };

  async function login(u: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/local/login').send({ username: u, password: PW }).expect(200);
    return (res.headers['set-cookie'] as unknown as string[]).join('; ');
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [ADMIN, USERB, NONAME] } } });
    const admin = await prisma.user.create({ data: { localUsername: ADMIN, localPasswordHash: await bcrypt.hash(PW, 10), role: 'admin', mustChangePassword: false, name: 'Share Admin' } });
    await prisma.user.create({ data: { localUsername: USERB, localPasswordHash: await bcrypt.hash(PW, 10), role: 'user', mustChangePassword: false, name: 'Share UserB' } });
    const noname = await prisma.user.create({ data: { localUsername: NONAME, localPasswordHash: await bcrypt.hash(PW, 10), role: 'admin', mustChangePassword: false, name: null } });

    // admin 的已发布模板 + v1
    const pub = await prisma.template.create({ data: { name: '可分享模板', data: VER_DATA, ownerId: admin.id, publishedVersion: 1 } });
    await prisma.templateVersion.create({ data: { templateId: pub.id, version: 1, data: VER_DATA } });
    pubTplId = pub.id;
    // admin 的未发布模板
    const unpub = await prisma.template.create({ data: { name: '未发布模板', data: VER_DATA, ownerId: admin.id } });
    unpubTplId = unpub.id;
    // owner.name=null 的已发布+公开模板
    const np = await prisma.template.create({ data: { name: '无名作者模板', data: VER_DATA, ownerId: noname.id, publishedVersion: 1, visibility: 'public' } });
    await prisma.templateVersion.create({ data: { templateId: np.id, version: 1, data: VER_DATA } });
    nonameTplId = np.id;

    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
    adminCookie = await login(ADMIN);
    userbCookie = await login(USERB);
  });
  afterAll(async () => {
    await prisma.template.deleteMany({ where: { ownerId: { in: (await prisma.user.findMany({ where: { localUsername: { in: [ADMIN, USERB, NONAME] } }, select: { id: true } })).map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { localUsername: { in: [ADMIN, USERB, NONAME] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('admin sets published template public', async () => {
    await request(app.getHttpServer()).patch(`/templates/${pubTplId}/visibility`).set('Cookie', adminCookie).send({ visibility: 'public' }).expect(200);
  });

  it('public template appears in GET /templates/public with ownerName', async () => {
    const res = await request(app.getHttpServer()).get('/templates/public?limit=100').set('Cookie', userbCookie).expect(200);
    const item = res.body.items.find((x: { id: string }) => x.id === pubTplId);
    expect(item).toBeTruthy();
    expect(item.ownerName).toBe('Share Admin');
  });

  it('ownerName falls back to — when owner has no name', async () => {
    const res = await request(app.getHttpServer()).get('/templates/public?limit=100').set('Cookie', userbCookie).expect(200);
    const item = res.body.items.find((x: { id: string }) => x.id === nonameTplId);
    expect(item.ownerName).toBe('—');
  });

  it('setting unpublished template public → 400', async () => {
    await request(app.getHttpServer()).patch(`/templates/${unpubTplId}/visibility`).set('Cookie', adminCookie).send({ visibility: 'public' }).expect(400);
  });

  it('non-admin cannot set visibility → 403', async () => {
    await request(app.getHttpServer()).patch(`/templates/${pubTplId}/visibility`).set('Cookie', userbCookie).send({ visibility: 'private' }).expect(403);
  });

  it('userB copies admin public template (cross-owner) → owned private draft', async () => {
    const res = await request(app.getHttpServer()).post(`/templates/${pubTplId}/copy`).set('Cookie', userbCookie).expect(201);
    const newId = res.body.id as string;
    const userb = await prisma.user.findUnique({ where: { localUsername: USERB } });
    const copy = await prisma.template.findUnique({ where: { id: newId } });
    expect(copy?.ownerId).toBe(userb!.id);
    expect(copy?.visibility).toBe('private');
    expect(copy?.publishedVersion).toBeNull();
    expect(copy?.hasUnpublishedChanges).toBe(true);
    expect(copy?.data).toEqual(VER_DATA);
  });

  it('copying a non-public template → 404', async () => {
    await request(app.getHttpServer()).post(`/templates/${unpubTplId}/copy`).set('Cookie', userbCookie).expect(404);
  });

  it("userB's own list (GET /templates) does not include admin templates", async () => {
    const res = await request(app.getHttpServer()).get('/templates?limit=100').set('Cookie', userbCookie).expect(200);
    const ids = res.body.items.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(pubTplId);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- template-sharing"` — Expected: FAIL(端点 404 / 方法不存在)。

- [ ] **Step 3: 实现 service 方法**

In `apps/api/src/templates/templates.service.ts`,把首行 import 的 `@nestjs/common` 加上 `BadRequestException`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```
在 class 末尾(`remove` 之后)追加三个方法:

```ts
  /** 公共库:列 public + 已发布模板(跨 owner,无 ownerId 过滤)。搜索只按 name。 */
  async listPublic(args: TemplateListArgs) {
    const limit = Math.min(Math.max(args.limit, 1), 100);
    const offset = Math.max(args.offset, 0);
    const q = args.search?.trim();
    const where: Prisma.TemplateWhereInput = {
      visibility: 'public',
      publishedVersion: { not: null },
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    };
    const orderBy: Prisma.TemplateOrderByWithRelationInput[] =
      args.sort === 'name'
        ? [{ name: 'asc' }, { id: 'asc' }]
        : args.sort === 'created'
          ? [{ createdAt: 'desc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'asc' }];
    const [rows, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          publishedVersion: true,
          updatedAt: true,
          owner: { select: { name: true } },
        },
      }),
      this.prisma.template.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerName: r.owner?.name ?? '—', // User.name 可空 → 兜底
      publishedVersion: r.publishedVersion,
      updatedAt: r.updatedAt,
    }));
    return { items, total, offset, limit };
  }

  /** 设可见性(admin 用;不按 ownerId 限定 → 可操作任意模板)。public 要求已发布。 */
  async setVisibility(id: string, visibility: 'private' | 'public') {
    const tpl = await this.prisma.template.findUnique({
      where: { id },
      select: { id: true, publishedVersion: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');
    if (visibility === 'public' && tpl.publishedVersion == null) {
      throw new BadRequestException('publish_before_public');
    }
    await this.prisma.template.update({ where: { id }, data: { visibility } });
    return { id, visibility };
  }

  /** 复制公共模板到 meId 名下:取源最新发布版 data(按 publishedVersion 列),成私有新草稿。 */
  async copyFromPublic(meId: string, sourceId: string) {
    // 约束 A:源查询不带 ownerId
    const src = await this.prisma.template.findFirst({
      where: { id: sourceId, visibility: 'public', publishedVersion: { not: null } },
      select: { id: true, name: true, description: true, publishedVersion: true },
    });
    if (!src) throw new NotFoundException('public_template_not_found');
    // 约束 B:按 publishedVersion 列取版本
    const ver = await this.prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId: src.id, version: src.publishedVersion! } },
      select: { data: true },
    });
    if (!ver) throw new NotFoundException('public_template_not_found');
    return this.prisma.template.create({
      data: {
        name: `${src.name} 副本`,
        description: src.description,
        data: ver.data as object,
        ownerId: meId,
        visibility: 'private',
        publishedVersion: null,
        hasUnpublishedChanges: true, // 副本全是未发布内容
      },
      select: { id: true, name: true },
    });
  }
```

- [ ] **Step 4: 实现 controller 端点**

In `apps/api/src/templates/templates.controller.ts`:

(a) 加 import(`@nestjs/common` 已含 BadRequestException;新增 Roles):
```ts
// eslint-disable-next-line import/no-unresolved
import { Roles } from '../auth/guards/roles.guard.js';
```

(b) 在现有 `ListQuery` 之后加公共库专用 query(默认排序 `updated`,命中索引):
```ts
const PublicListQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['updated', 'name', 'created']).default('updated'),
});
```

(c) 在 `@Get()`(list)方法之后、`@Get(':id/versions')` 之前,加 `GET /public`(**必须在任何 `:id` 路由之前**):
```ts
  @Get('public')
  async listPublic(@Query() rawQuery: unknown) {
    const parsed = PublicListQuery.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const q = parsed.data;
    return this.svc.listPublic({
      offset: q.offset,
      limit: q.limit,
      search: q.search ?? null,
      sort: q.sort,
    });
  }
```

(d) 在 `@Post(':id/rollback')` 之后加可见性 + 复制端点:
```ts
  @Patch(':id/visibility')
  @Roles('admin', 'emergency_admin')
  async setVisibility(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const parsed = z.object({ visibility: z.enum(['private', 'public']) }).safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.svc.setVisibility(id, parsed.data.visibility);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.visibility.change',
      resourceType: 'template',
      resourceId: id,
      details: { visibility: parsed.data.visibility },
      request: req,
    });
    return result;
  }

  @Post(':id/copy')
  async copy(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Req() req: Request) {
    const result = await this.svc.copyFromPublic(me.sub, id);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.copy',
      resourceType: 'template',
      resourceId: result.id,
      details: { from: id },
      request: req,
    });
    return result;
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm test -- template-sharing"` — Expected: PASS(全部 8 个用例)。

> 注:`POST :id/copy` 默认返回 201(Nest @Post 默认),e2e 已按 201 断言。

- [ ] **Step 6: typecheck + lint + 回归**

Run: `docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck && pnpm run lint && pnpm test"` — Expected: 0 错误、0 告警、全量 e2e 绿。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/templates/templates.service.ts apps/api/src/templates/templates.controller.ts apps/api/test/template-sharing.e2e.spec.ts
git commit -m "feat(templates): 公共模板库后端 — listPublic/setVisibility(admin)/copyFromPublic"
```

---

## Task 3: 前端 — 我的/公共 tab + 公共库列表 + 复制 + admin 公开开关

**Files:** Modify `apps/web/src/stores/templates.ts`、`apps/web/src/views/TemplatesView.vue`。

- [ ] **Step 1: store 加公共库取数 + 复制 + 设可见性**

In `apps/web/src/stores/templates.ts`,在 `TemplateListItem` 接口后加公共项类型:
```ts
export interface PublicTemplateListItem {
  id: string;
  name: string;
  description: string | null;
  ownerName: string;
  publishedVersion: number | null;
  updatedAt: string;
}
```
在 `actions` 内(`remove` 之后)加三个 action:
```ts
    async fetchPublicSlice(params: {
      offset: number;
      limit: number;
      search: string;
      sort: 'updated' | 'name' | 'created';
    }): Promise<{ items: PublicTemplateListItem[]; total: number }> {
      const qs = new URLSearchParams({
        offset: String(params.offset),
        limit: String(params.limit),
        sort: params.sort,
      });
      const search = params.search.trim();
      if (search) qs.set('search', search);
      const res = await apiFetch<{ items: PublicTemplateListItem[]; total: number }>(
        `/templates/public?${qs.toString()}`,
      );
      return { items: res.items, total: res.total };
    },
    async copyFromPublic(id: string): Promise<{ id: string; name: string }> {
      return apiFetch<{ id: string; name: string }>(`/templates/${id}/copy`, { method: 'POST' });
    },
    async setVisibility(id: string, visibility: 'private' | 'public'): Promise<void> {
      await apiFetch<{ id: string; visibility: string }>(`/templates/${id}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      });
    },
```

- [ ] **Step 2: TemplatesView — script:tab 状态 + isAdmin + 公共库取数/复制/公开开关**

In `apps/web/src/views/TemplatesView.vue` `<script setup>`:

(a) import 加 auth store + 公共类型 + 一个图标:
```ts
import { useAuthStore } from '../stores/auth';
import { type PublicTemplateListItem } from '../stores/templates';
import { Globe } from 'lucide-vue-next';
```
(把 `Globe` 并入已有的 `lucide-vue-next` import 列表;`PublicTemplateListItem` 并入已有 `../stores/templates` import。)

(b) 在 `const templates = useTemplatesStore();` 附近加:
```ts
const auth = useAuthStore();
const isAdmin = computed(
  () => auth.user?.role === 'admin' || auth.user?.role === 'emergency_admin',
);
const activeTab = ref<'mine' | 'public'>('mine');
const publicItems = ref<PublicTemplateListItem[]>([]);
const publicTotal = ref(0);
const publicLoading = ref(false);

async function loadPublic(): Promise<void> {
  publicLoading.value = true;
  try {
    const res = await templates.fetchPublicSlice({
      offset: 0,
      limit: 100,
      search: searchQuery.value,
      sort: sortBy.value === 'created' ? 'updated' : sortBy.value,
    });
    publicItems.value = res.items;
    publicTotal.value = res.total;
  } finally {
    publicLoading.value = false;
  }
}

async function copyPublic(t: PublicTemplateListItem): Promise<void> {
  try {
    const created = await templates.copyFromPublic(t.id);
    ElMessage.success(`已复制到「我的模板」:${created.name}`);
    activeTab.value = 'mine';
    await reloadActive();
  } catch {
    ElMessage.error('复制失败');
  }
}

async function toggleVisibility(t: TemplateListItem): Promise<void> {
  if (t.publishedVersion == null) {
    ElMessage.warning('请先发布该模板，才能设为公开');
    return;
  }
  const makePublic = (t as TemplateListItem & { visibility?: string }).visibility !== 'public';
  try {
    await templates.setVisibility(t.id, makePublic ? 'public' : 'private');
    ElMessage.success(makePublic ? '已设为公开' : '已取消公开');
    await refreshAfterMutation();
  } catch {
    ElMessage.error('操作失败');
  }
}

function switchTab(tab: 'mine' | 'public'): void {
  activeTab.value = tab;
  if (tab === 'public') void loadPublic();
  else void reloadActive();
}
```

> 说明:`reloadActive()`(首次/搜索/排序回到起点)与 `refreshAfterMutation()`(增删改后保持页位)是该视图**已有**函数(`TemplatesView.vue:139/150`)。`toggleVisibility` 依赖 `TemplateListItem` 含 `visibility` 字段 —— **Step 3 在 store 的 `TemplateListItem` 接口补 `visibility: string`,并确认后端 `GET /templates`(my-list)的 select 含 `visibility`**(见下)。

- [ ] **Step 3: 让「我的列表」带回 visibility(供 admin 开关判断当前态)**

后端 `templates.service.ts` 的 `list()` 的 `select` 加一行 `visibility: true`:
```ts
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          publishedVersion: true,
          hasUnpublishedChanges: true,
          visibility: true,
        },
```
前端 `stores/templates.ts` 的 `TemplateListItem` 加 `visibility: string;`。

- [ ] **Step 4: TemplatesView — template:tab 栏 + 公共库列表 + 卡片 admin 开关**

(a) 在 `<div class="tv-inner">` 内、`<!-- 工具栏 -->` 之前,加 tab 栏:
```html
          <div class="tv-tabs">
            <button type="button" :class="{ active: activeTab === 'mine' }" @click="switchTab('mine')">我的模板</button>
            <button type="button" :class="{ active: activeTab === 'public' }" @click="switchTab('public')">
              <Globe :size="13" :stroke-width="1.6" /> 公共模板库
            </button>
          </div>
```

(b) 把现有「我的」列表区(加载态 + grid + list 三块)用 `v-if="activeTab === 'mine'"` 包裹(或在其外层容器加该条件);在其后加公共库区块:
```html
          <div v-if="activeTab === 'public'" class="tpl-public">
            <div v-if="publicLoading" class="empty-line">加载中…</div>
            <div v-else-if="publicItems.length === 0" class="empty-line">公共模板库暂无内容</div>
            <div v-else class="tpl-grid">
              <div v-for="t in publicItems" :key="t.id" class="tpl tpl--public">
                <div class="tpl-thumb">
                  <span class="stamp">{{ paperLabel() }}</span>
                  <TemplateThumb v-if="t.publishedVersion != null" :template-id="t.id" :version="t.publishedVersion" />
                </div>
                <div class="tpl-body">
                  <span class="name">{{ t.name }}</span>
                  <span class="meta">
                    <span>作者 {{ t.ownerName }}</span>
                    <span class="sep">·</span>
                    <span>v{{ t.publishedVersion }}</span>
                  </span>
                  <button type="button" class="btn btn-primary sm copy-btn" @click="copyPublic(t)">复制到我的</button>
                </div>
              </div>
            </div>
          </div>
```

(c) admin 公开开关:在「我的」grid 卡的 `.tpl-actions` 里(以及 list 行对应操作处),加一个仅 admin 可见的按钮:
```html
                <button
                  v-if="isAdmin"
                  type="button"
                  :title="(t.visibility === 'public') ? '取消公开' : '设为公开'"
                  @click.stop="toggleVisibility(t)"
                >
                  <Globe :size="12" :stroke-width="1.8" />
                </button>
```
(`t.visibility` 现已随 my-list 返回;未发布时点开关会被 `toggleVisibility` 拦截并提示先发布。)

(d) 计数行/标题可按需根据 `activeTab` 文案微调(非必须)。

- [ ] **Step 5: typecheck + lint**

Run: `docker exec template_printing-web sh -c "cd /workspace/apps/web && pnpm run typecheck && pnpm run lint"` — Expected: 0 错误、0 告警。
(同时确认 api typecheck 仍过:Step 3 改了 service select。`docker exec template_printing-api sh -c "cd /workspace/apps/api && pnpm run typecheck"`。)

- [ ] **Step 6: 手测**

admin 登录 → 我的模板某已发布模板点 🌐 设为公开 → 切「公共模板库」tab 见该模板(作者名正确)→ 换个普通用户登录 → 公共库点「复制到我的」→ 切回我的见副本(草稿标记)→ 打开副本可编辑。未发布模板点 🌐 提示先发布。非 admin 看不到 🌐。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/stores/templates.ts apps/web/src/views/TemplatesView.vue apps/api/src/templates/templates.service.ts
git commit -m "feat(web): 模板中心 我的/公共 tab + 公共库复制 + admin 公开开关"
```

---

## Task 4: 文档同步

**Files:** Modify `docs/PROGRESS.md`(+ 视情况 `AGENTS.md`)。

- [ ] **Step 1: PROGRESS**

`docs/PROGRESS.md`:顶部「最近更新」日期改 2026-05-27(已是)并补一句模板分享;§3 近期变更顶部加 `### 2026-05-27` 下一条:
```markdown
- **feat：模板分享 / 公共模板库** —— Template 加 `visibility`(private/public);新增 `GET /templates/public`(列已发布的公开模板,跨 owner,作者名 null 兜底 `—`)、`PATCH /templates/:id/visibility`(仅 admin/emergency_admin)、`POST /templates/:id/copy`(任意用户复制公共模板:取最新发布版 data → 我名下私有新草稿 `hasUnpublishedChanges=true`)。前端模板中心加「我的/公共」tab + 公共库「复制到我的」+ admin「设为公开」开关。约束:公共相关查询不带 ownerId、copy 取版本走 `publishedVersion` 列。
```
§2.2 能力补一条「模板可见性 + 公共模板库(管理员上架 / 用户复制)」;§5 后续计划把「模板分享 / 公共模板库」标 ✅ 完成。

- [ ] **Step 2: AGENTS.md(按需)**

若 `AGENTS.md` 有 Template 字段/端点清单,补 `visibility` 与三个端点;无则跳过(说明)。

- [ ] **Step 3: 提交**

```bash
git add docs/PROGRESS.md AGENTS.md
git commit -m "docs: 同步模板分享/公共模板库"
```

---

## Self-Review(写计划后自检)

**Spec 覆盖:** §3 约束A(无 ownerId/copy 源查询)→ T2 service 三方法均按 `{id}`/`{id,visibility,published}` 查 ✅;约束B(publishedVersion 列)→ T2 copyFromPublic ✅;§4 DB(visibility+索引+非破坏迁移)→ T1 ✅;§5.1 listPublic(name 搜索 + ownerName 兜底 + 默认 updated)→ T2 service + PublicListQuery ✅;§5.2 setVisibility(无 owner + published 校验)→ T2 ✅;§5.3 copy(私有/publishedVersion=null/hasUnpublishedChanges=true)→ T2 ✅;§5.4 端点(public 前置 / @Roles / copy)→ T2 ✅;§6 前端(tab/公共列表/复制/admin 开关)→ T3 ✅;§7 测试(8 e2e + 手测)→ T2/T3 ✅;不排除自身 + 允许复制自己 → listPublic/copy 均无 owner 限制 ✅。

**占位符扫描:** 无 TBD/TODO;每步含完整代码或确切命令;复用的现有函数名已核对落实(`reloadActive`/`refreshAfterMutation` @ `TemplatesView.vue:139/150`、`templates.fetchSlice`、`paperLabel`/`TemplateThumb` 等)。

**类型一致性:** `visibility:'private'|'public'` 跨 service/controller/store/测试一致;`PublicTemplateListItem`(含 ownerName)store 定义、view 使用一致;`TemplateListItem` 加 `visibility` 后 my-list select 同步返回(T3 Step3)避免前端读 undefined。
