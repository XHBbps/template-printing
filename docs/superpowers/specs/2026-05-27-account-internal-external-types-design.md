# 账号内部/外部双类型 + 身份展示 + 权限强制 设计文档

> 状态:已与用户确认设计,进入实现计划阶段。
> 日期:2026-05-27
> 范围:把账号收敛为两类互斥(飞书SSO=内部 / 本地账号密码=外部,初始管理账号视为内部),据此驱动权限(外部不能发布公共模板、不能调 API、不能被授权管理员),按类型重构个人中心展示,新增内部手机号与外部唯一ID,并把"应急管理员"更名为"超级管理员"。顺带移除已失效且会死锁的「解绑飞书」流程。

---

## 背景与动机

当前 `User` 模型允许同一账号**同时**持有飞书身份(`larkOpenId/larkUnionId/larkUserId`)与本地凭证(`localUsername/localPasswordHash`),`users.service` 因此派生出 `lark/local/both` 三类。这带来一个**死锁**:纯飞书(SSO)用户解绑飞书前必须先设本地密码,而 SSO 自动建号没有 `localUsername`,`setPassword` 首设分支抛 `local_username_required`,且无任何自助设 `localUsername` 的入口 → 纯飞书用户永远设不了密码、永远解不了绑。

业务上账号本应只有两类:
- **内部**:飞书 SSO 登录的员工账号 + 部署时的初始管理账号。
- **外部**:管理员创建的账号密码账号(初始管理账号除外)。

两类互斥后,「解绑」语义消失(SSO 账号要走就删/禁用),死锁随之消除。类型进一步驱动权限。

---

## 1. 账号分类(纯派生,不新增分类列)

判定(单一来源,放 `apps/api/src/auth/account-kind.ts` 或并入 `user-state.service`):
```
isInternal(user) = user.larkOpenId != null || user.role === 'emergency_admin'
isExternal(user) = !isInternal(user)
```
- 内部 = 飞书账号(有 `larkOpenId`) ∪ 超级管理员(`emergency_admin`,本地 bootstrap)。
- 外部 = 其余(管理员创建的本地账号)。

与现有字段完全等价,零迁移即可表达分类。`users.service` 的 `accountType` 列表派生改为暴露 `internal/external`(展示标签:内部/外部)。

## 2. 新增 User 字段(additive 无损迁移)

| 字段 | 类型 | 用途 | 来源 |
|---|---|---|---|
| `mobile` | `String?` `@map("mobile")` | 内部手机号 | 飞书 `LarkUserInfo.mobile`(userinfo 已返回,见 `lark.service.ts:27`) |
| `externalCode` | `String?` `@unique @map("external_code")` | 外部唯一ID,如 `W00000001` | 外部建号时分配 |

迁移约束(遵守仓库底线):**仅新增可空列**,走正常 additive migration(`prisma migrate dev --create-only` 审核后 `migrate deploy`),**禁止** `migrate reset` / `db push --accept-data-loss`。

### 外部唯一ID 生成
- 格式:固定首字母 `W` + 8 位补零序号,从 `00000001` 起(`W00000001`、`W00000002`…)。
- 分配:在 `users.service.create` 外部建号的**事务内**,取「现有 `externalCode` 解析出的最大序号 + 1」,格式化为 `W` + `String(n).padStart(8, '0')`,写入 `externalCode`。低并发(管理员手动建号),事务内 max+1 足够;`@unique` 兜底防撞。
- 内部账号 `externalCode` 恒为 null;唯一值用 `larkUserId`(纯数字工号),加首字母后与外部必不冲突。

## 3. 个人中心(按类型展示)

`MeResponse` 增加 `isInternal: boolean`、`mobile: string | null`、`externalCode: string | null`(已有 `larkUserId`、`hasLocalPassword`)。前端 `MeView` 按 `isInternal` 渲染:

| 字段 | 内部(SSO) | 外部 |
|---|---|---|
| 用户名 | 飞书 `name`(中文名) · 只读 | `localUsername` · **可编辑** |
| 手机号 | 飞书 `mobile` · 只读 | 不显示 |
| 邮箱 | 飞书 `email` · 只读 | `email` · **可编辑** |
| 唯一ID | `larkUserId`(工号) · 只读 | `externalCode`(W…) · 只读 |
| 密码区 | 不显示 | 显示「修改密码」 |
| 解绑飞书 | 移除 | — |

- 内部资料随每次飞书登录同步(`lark.controller` 已更新 `name/email/avatar`,**新增同步 `mobile`**),个人中心只读。
- 超级管理员(`emergency_admin`,本地 bootstrap):`isInternal=true` → 资料只读;但 `hasLocalPassword=true` → **显示「修改密码」**;唯一ID 展示其 `localUsername`(无工号/无 externalCode)。
- 编辑入口:`PATCH /users/me`(`updateProfile`)对内部账号拒绝改 `name`(只读),外部允许改 `localUsername`/`email`。`name` 与 `localUsername` 的写入区分见实现计划。

## 4. 权限强制(后端)

| 能力 | 规则 | 落点 |
|---|---|---|
| 调用 API | 外部禁止签发:`POST /users/me/api-tokens` 仅内部(外部 403 `external_account_forbidden`);`ApiAuthGuard` 兜底:token 关联用户若为外部则拒绝 | `ApiTokenController.create` + `api-auth.guard.ts` |
| 授权管理员 | `changeRole` 目标设为 `admin` 时要求目标内部(`larkOpenId != null`);外部 → 403 `external_cannot_be_admin` | `users.service.changeRole` |
| 发布公共模板 | `PATCH :id/visibility` 已是 `@Roles('admin','emergency_admin')`,外部永不为 admin → 自动挡。补 e2e 锁定,并核实 `POST /templates`(create)与 `PATCH :id`(update)不接受/不落 `visibility:'public'`(仅 `:id/visibility` 可改可见性) | `templates.controller` / `templates.service` |

`ApiAuthGuard` 当前已校验 `disabledAt`;在其取到关联用户时加 `isInternal` 判定即可(需 select `larkOpenId, role`)。

## 5. 角色更名(仅展示层,role 值不变)

- 展示名:`emergency_admin` → 「**超级管理员**」(原"应急管理员");`admin` → 「管理员」;`user` → 「普通用户」。
- 超级管理员**仅初始 bootstrap 账号固定、不可分配**:后台角色下拉仅 `普通用户 / 管理员` 两项,且 `管理员` 仅对**内部**账号可选(外部禁用 + 提示"仅内部账号可授权管理员");超管账号角色只读展示、不出现在可改选项。
- `changeRole` 入参仍是 `'user' | 'admin'`(不接受 `emergency_admin`),保持不可分配超管。
- 涉及展示更名的位置:`UsersAdminView`(角色列/下拉)、`AuditLogView`(角色相关 label)、`MeView`(角色显示),以及任何出现"应急管理员"文案处。后端 `role` 值、路由守卫、`@Roles('admin','emergency_admin')`、CLAUDE.md 所述前端守卫规则**全部不动**。

## 6. 认证清理(落实两类互斥 + 解死锁)

- **删除「解绑飞书」**:`DELETE /users/me/lark-binding`(`me.controller.unbindLark`)+ `MeView` 解绑按钮/确认弹窗。`AuditLogView` 的 `user.lark.unbind` label 保留(历史日志仍需翻译),但不再产生该动作。
- **`setPassword` 改为仅"改密"**:移除首次设密码分支(`!wasSet` 路径与 `local_username_required`)。理由:外部建号即带密码、超管 bootstrap 带密码、SSO 无密码也不允许设 → 首设分支已无合法触达者。`setPassword` 始终要求 `currentPassword` 正确。
- 确保无任何路径产生"飞书+本地"混合账号(唯一能产生的 setPassword-SSO 分支已删)。

## 影响文件(概览)

**后端**
- `apps/api/prisma/schema.prisma` —— User 加 `mobile`、`externalCode`(+ 迁移)。
- `apps/api/src/auth/account-kind.ts`(新)—— `isInternal/isExternal`。
- `apps/api/src/auth/lark/lark.controller.ts` —— 登录同步写入 `mobile`。
- `apps/api/src/auth/controllers/me.controller.ts` —— `MeResponse` 增字段;删 `unbindLark`;`setPassword` 改仅改密;`updateProfile` 内部只读。
- `apps/api/src/auth/api-token/api-token.controller.ts` + `guards/api-auth.guard.ts` —— 外部禁 API。
- `apps/api/src/users/users.service.ts` —— `create` 分配 `externalCode`;`changeRole` 内部才可 admin;列表派生 internal/external。
- `apps/api/src/templates/*` —— 核实/锁定 public 仅 admin。

**前端**
- `apps/web/src/views/MeView.vue` —— 按类型展示 + 删解绑 + 密码区按 `hasLocalPassword`。
- `apps/web/src/views/admin/UsersAdminView.vue` —— 角色更名 + 下拉规则(外部禁 admin、超管不可分配) + 内部/外部标签。
- `apps/web/src/views/admin/AuditLogView.vue` —— 角色相关 label 更名。
- 鉴权/类型相关 store 与接口类型(`MeResponse` 等)同步增字段。

**文档**
- `docs/PROGRESS.md`、`docs/qa/template-module-verification-checklist.md`(删解绑那条)、相关 spec。

## 测试

- **后端 e2e**
  - 外部账号:`POST /users/me/api-tokens` → 403;`changeRole(target=external, 'admin')` → 403;`PATCH :id/visibility public`(外部本就非 admin)→ 403/无权限。
  - 内部账号:上述均可(api-token 可签发;内部可被提升 admin;admin 可改可见性)。
  - 外部建号:连续建两个 → `externalCode` 为 `W00000001`、`W00000002`,递增且唯一。
  - 飞书登录:`mobile` 写入 User;`MeResponse.isInternal=true`、`mobile/larkUserId` 正确。
  - 超管:`changeRole` 不接受 `emergency_admin`;超管账号 `isInternal=true`。
- **schema/单测**:account-kind 判定;externalCode 格式化。
- **手测**:个人中心两类展示(内部只读/外部可编辑用户名邮箱);后台角色下拉文案与禁用规则;原解绑入口消失。
- typecheck + lint(api + web + schema);api e2e 跑通。

## 不做 / 约束

- 不新增"分类列"(纯派生);不引入"外部 SSO / 内部本地"等当前无需求的组合。
- 不改 `role` 取值、不改路由守卫与 `@Roles`;超级管理员不可经 UI 分配。
- 迁移仅 additive 可空列;禁止 reset / `db push --accept-data-loss`。
- 外部用户仍可**完整使用私有模板**(新建/编辑/发布/填数据/预览/打印/导出),仅禁公共库与 API。
- 不动系统其他位置无关的占位/文案。
- 不引入新依赖。
