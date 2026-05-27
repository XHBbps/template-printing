# 模板分享 / 公共模板库 设计文档

> 状态:已与用户确认设计(含 6 点复核修正),进入实现计划阶段。
> 日期:2026-05-27
> 范围:模板新增 `private/public` 可见性;管理员可把已发布模板上架为公共;任意登录用户可浏览公共模板库并「复制到我的账号」。

---

## 1. 背景与现状

`apps/api/src/templates/`(controller + service)目前**严格单 owner**:`list/get/update/remove/publish/rollback` 每个方法都 `findFirst({ id, ownerId })`,`update/remove` 内部复用 `get(ownerId, id)` 做归属校验。无可见性、无复制、无团队概念。`TemplatesView` 有 grid/list 视图切换,但无「我的/公共」tab。

本系统**无团队/分组模型**(只有 `user`/`admin`/`emergency_admin` 角色),故"团队共享"落地为"公开给全内网"。

## 2. 已确认决策

- 可见性:仅 `private` / `public`(无团队 ACL)。
- 上架权限:仅 `admin` / `emergency_admin` 能把模板设为公开。
- 消费端:看到公共模板的人**只能「复制到我的」**(只读,不能改原件)。
- 公共库**只列已发布**模板;复制取**最新发布版** data → 我名下全新私有草稿。
- v1 前端「设为公开」开关只挂在 admin **自己拥有**的模板上(后端允许 admin 操作任意模板,但给别人模板上架在 v1 只能直接调 API —— 这是**故意的能力差**,YAGNI)。

## 3. 硬性约束(实现必须遵守,最易写错)

### 约束 A — 新功能查询禁止带 ownerId 过滤,禁止复用 `get(ownerId,id)`
`copy` / `setVisibility` / `listPublic` 跨 owner 工作。**绝不能**复用现有 `get(ownerId,id)`(owner 不匹配会直接 404,用户永远 copy 不到别人的模板)。必须写全新的、不带 ownerId 的查询:
- `copy` 的源查询条件固定为 `{ id, visibility: 'public', publishedVersion: { not: null } }`,**与 ownerId 无关**;查不到 → 404 `public_template_not_found`。
- `setVisibility` 按 `{ id }` 查(admin 可操作任意模板),查不到 → 404。
- `listPublic` 按 `{ visibility: 'public', publishedVersion: { not: null } }` 查,**无 ownerId**。

### 约束 B — copy 取版本走 `publishedVersion` 列 + `templateId_version` 唯一键,不用 max(version)
读发布版 data 必须:`templateVersion.findUnique({ where: { templateId_version: { templateId: src.id, version: src.publishedVersion } } })`。**不要**用 `aggregate _max version`(当前 publish/rollback 恒等只是隐式假设,按 `publishedVersion` 列更准、更抗未来改动)。

## 4. 数据模型

`apps/api/prisma/schema.prisma` 的 `Template`:
- 新增 `visibility String @default("private")`(取值 `private` | `public`,应用层约束)。
- 新增索引 `@@index([visibility, updatedAt(sort: Desc)])`(与现有 `@@index([ownerId, updatedAt(sort: Desc)])` 同构,支撑公共库列表)。
- 迁移:`ADD COLUMN visibility ... DEFAULT 'private'`,存量全部置 `private`(非破坏)。用 `prisma migrate dev` 在 dev 库生成迁移文件(**禁止** `db push --accept-data-loss` / `migrate reset`)。

> Owner 级联(已存在 `onDelete: Cascade`,schema.prisma:54):删除某管理员会连带删除其上架的公共模板;但**已被他人 copy 的副本是独立 data 快照**,不受影响,可存活。可接受。

## 5. 后端(`apps/api/src/templates/`)

新增 service 方法 + controller 端点(均不动现有 owner 限定方法):

### 5.1 `listPublic(args)` — service
```
where: { visibility: 'public', publishedVersion: { not: null }, ...(search ? { name: { contains, mode:'insensitive' } } : {}) }
```
- **搜索只按 `name`**(不照搬现有 `OR(name,id)` —— 对公共库用户搜 id 无意义)。
- `include`/`select` 带 `owner: { select: { name: true } }`;响应 `ownerName = owner?.name ?? '—'`(`User.name` 可空,emergency_admin 无 Lark 身份时为 null,**必须 null 兜底**)。
- 返回每项:`{ id, name, description, ownerName, publishedVersion, updatedAt }` + `{ total, offset, limit }`,复用现有偏移分页风格。

### 5.2 `setVisibility(id, visibility)` — service
- 按 `{ id }` 查(无 ownerId,约束 A);不存在 → 404 `template_not_found`。
- 设为 `public` 时校验 `publishedVersion != null`,否则 400 `publish_before_public`。
- `update({ where:{id}, data:{ visibility } })`。

### 5.3 `copyFromPublic(meId, sourceId)` — service
- 源查询 `{ id: sourceId, visibility:'public', publishedVersion:{ not:null } }`(约束 A);查不到 → 404 `public_template_not_found`。
- 取发布版 data(约束 B:按 `publishedVersion` 列查 `templateId_version`)。
- 新建模板:`{ name: \`${src.name} 副本\`, description: src.description, data: <发布版 data>, ownerId: meId, visibility: 'private', publishedVersion: null, hasUnpublishedChanges: true }`。
  - **`hasUnpublishedChanges: true`**(副本 data 全是未发布内容,应在新主人列表里显示草稿标记;Prisma 默认 false 不符语义)。
- 返回新模板(至少 `{ id, name }`)。

### 5.4 controller 端点
- `@Get('public')` —— **定义在 `@Get(':id')` 之前**(否则 `public` 被当 `:id`)。任意登录用户。复用 `ListQuery`(offset/limit/search/sort)。
- `@Patch(':id/visibility')` `@Roles('admin','emergency_admin')` —— body `z.object({ visibility: z.enum(['private','public']) })`。审计 `template.visibility.change`,details `{ visibility }`。
- `@Post(':id/copy')` —— 任意登录用户。审计 `template.copy`,details `{ from: sourceId, newId }`。

## 6. 前端(`apps/web/src/views/TemplatesView.vue`)

- 顶部新增 **tab:「我的模板」/「公共模板库」**(置于现有 grid/list 视图切换之上)。tab 切换数据源:
  - 我的:现有 `GET /templates`(不变)。
  - 公共:`GET /templates/public`(只读列表:名称 + 作者 `ownerName` + 已发布版本号 + 「复制到我的」按钮;无编辑/删除/发布入口)。
- 「复制到我的」→ `POST /templates/:id/copy` → 成功 toast → 切回「我的」tab 并刷新(定位/打开新副本)。
- **admin 专属**:「我的模板」每张卡操作区加「设为公开 / 取消公开」开关 → `PATCH /templates/:id/visibility`;仅 `publishedVersion != null` 可点(未发布置灰 + 提示先发布);非 admin 不渲染该开关。
- 复用现有 `apiFetch`、分页、搜索去抖等;公共 tab 的搜索走同一 `searchQuery`。

## 7. 测试

后端 e2e(`apps/api/test/`,真实 dev pg):
- admin 把已发布模板设 `public` → 出现在 `GET /templates/public`(含正确 ownerName)。
- 未发布模板设 `public` → 400 `publish_before_public`。
- 非 admin 调 `PATCH :id/visibility` → 403(RolesGuard)。
- 用户 `POST :id/copy` 公共模板 → 新模板归属调用者、`visibility=private`、`publishedVersion=null`、`hasUnpublishedChanges=true`、data == 源发布版 data;**且源模板属于另一个 owner**(验证约束 A:跨 owner 能 copy)。
- copy 非公开 / 未发布模板 → 404 `public_template_not_found`。
- 现有「我的」`GET /templates` 仍只含自己(回归)。
- ownerName 在 owner.name 为 null 时回退 `'—'`。

前端手测:tab 切换、公共库列表 + 复制 + 切回定位、admin 开关(已发布可点/未发布置灰/非 admin 不显示)。

## 8. 文档同步(AGENTS §9)

- `docs/PROGRESS.md`:§3 近期变更追加;§2.2 能力补「模板可见性/公共库」;§5 后续计划该项标完成;顶部日期。
- `AGENTS.md`:若 Template 字段说明处需补 `visibility`(按实际)。
- 无新增环境变量。

## 9. 不做 / 约束

- 不建团队/分组模型;不做「管理员浏览全部模板上架别人模板」的全局视图(v1 仅 API 可对别人模板上架)。
- 公共模板消费端只读 + 复制;不支持直接渲染公共模板 / 查看其版本历史。
- 不改现有 owner 限定方法的任何行为。
- 不引入新依赖。
