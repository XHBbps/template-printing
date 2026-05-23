# Iteration 17 — Global Layout & Routes Spec

**Goal:** 给整个平台加全局可折叠侧边栏 + 多页面路由。当前阶段只做最小可用集（方案 A），把未来扩展的位置先留出来。

**Scope:** 前端架构调整（路由 + 布局 + 5 个占位页面）。**不涉及**后端 API、权限校验、登录态（auth 在 iter 18 做）。

---

## 现状

- 路由表：`/`（HomeView）、`/designer/new`、`/designer/:id`（DesignerView）
- 无全局 chrome —— DesignerView 自身有 toolbar，没有上层导航
- 无登录、无权限、无 404 / 403 处理

## 目标架构

```
┌─────────────────────────────────────────────────────┐
│ AppShell.vue                                        │
│ ┌──────────────┬──────────────────────────────────┐ │
│ │ Sidebar      │ <router-view />                  │ │
│ │ (collapsible)│                                  │ │
│ │              │                                  │ │
│ │ 📋 模板中心  │                                  │ │
│ │ 👤 个人中心  │                                  │ │
│ │ 🔑 API 说明  │                                  │ │
│ │ 👥 用户管理  │                                  │ │
│ │              │                                  │ │
│ └──────────────┴──────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**例外**：DesignerView 不要全局 sidebar（设计器需要全宽画布空间）。AppShell 在 DesignerView 路由下渲染 `<router-view>` 但 sidebar 隐藏 / 切换为 minimal mode。

---

## 路由表

| Path | Page | 说明 |
|---|---|---|
| `/` | TemplatesView | 模板列表（默认首页，替代当前 HomeView） |
| `/designer/new` | DesignerView | 新建模板（保留现有，全屏，无 sidebar） |
| `/designer/:id` | DesignerView | 编辑模板（保留现有，全屏，无 sidebar） |
| `/me` | MeView | 个人中心（占位） |
| `/api-docs` | ApiDocsView | API 说明（占位） |
| `/admin/users` | UsersAdminView | 用户管理（占位 + role guard） |
| `/401` | UnauthorizedView | 401 未登录 |
| `/403` | ForbiddenView | 403 无权限 |
| `/404` | NotFoundView | 404 找不到 |
| `*` (catch-all) | redirect → `/404` | |

iter 17 内做：路由 + AppShell + Sidebar + 上述 5 个新页面的**骨架**（不实现具体功能）。

iter 17 **不**做：登录 / auth guard 实际生效（占位 UI 默认所有人能访问，等 iter 18 接入 auth）。

---

## 组件设计

### `AppShell.vue` (new)
顶层 layout。包含 sidebar + 内容区。检测当前路由：
- 路由属于 `/designer/*` → 隐藏 sidebar，给 router-view 满宽
- 其他路由 → 显示 sidebar

```vue
<template>
  <div class="app-shell">
    <Sidebar v-if="!isDesigner" v-model:collapsed="sidebarCollapsed" />
    <main class="app-main" :class="{ 'app-main--full': isDesigner }">
      <router-view />
    </main>
  </div>
</template>
```

### `Sidebar.vue` (new)
左侧导航。
- 默认宽度 220px，折叠后 56px（只显示 icon）
- 折叠状态本地持久化到 localStorage（`tp_sidebar_collapsed`）
- 高亮当前路由
- 顶部 logo（占位）
- 底部用户头像（暂时显示「未登录」占位）

```vue
<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <div class="sidebar-head">
      <Logo />
      <button @click="toggleCollapsed">‹/›</button>
    </div>
    <nav>
      <RouterLink to="/" class="nav-item">
        <FileText :size="16" />
        <span v-if="!collapsed">模板中心</span>
      </RouterLink>
      <RouterLink to="/me" class="nav-item">
        <User :size="16" />
        <span v-if="!collapsed">个人中心</span>
      </RouterLink>
      <RouterLink to="/api-docs" class="nav-item">
        <Key :size="16" />
        <span v-if="!collapsed">API 说明</span>
      </RouterLink>
      <RouterLink to="/admin/users" class="nav-item">
        <Users :size="16" />
        <span v-if="!collapsed">用户管理</span>
      </RouterLink>
    </nav>
    <div class="sidebar-foot">
      <!-- iter 18 渲染用户头像 -->
      <span class="muted">{{ collapsed ? '👤' : '未登录' }}</span>
    </div>
  </aside>
</template>
```

样式参考当前 designer 浮卡风格（紫色 token + 大圆角），但作为固定布局（不浮动）。

### 占位页面

**TemplatesView.vue**：模板列表 —— 拉 `/api/templates` (mock data ok for iter 17) → 展示卡片列表 → 点击进 `/designer/:id`。**附「+ 新建模板」按钮 → /designer/new**。

**MeView.vue / ApiDocsView.vue / UsersAdminView.vue**：纯占位，显示「该功能开发中 — Iter ?? 实现」。

**401 / 403 / 404 View**：友好错误页 —— 图标 + 简短文案 + 回首页按钮。401 自动重定向到 `/login`（iter 18 实现）。

---

## 实施步骤（iter 17 内拆 ~8 个 task）

1. 新建 `AppShell.vue` + 路由结构调整（main.ts / router.ts）
2. 新建 `Sidebar.vue` + 折叠状态 + localStorage 持久化
3. 替换 `HomeView` 为 `TemplatesView`（拉列表 + 卡片网格 + 新建按钮）
4. 占位页：`MeView.vue` / `ApiDocsView.vue` / `UsersAdminView.vue`
5. 错误页：`UnauthorizedView.vue` / `ForbiddenView.vue` / `NotFoundView.vue`
6. router 加 catch-all redirect 到 /404
7. DesignerView 路由保留全屏，AppShell 自动检测路由名隐藏 sidebar
8. 验收（路由切换、sidebar 折叠、错误页跳转）

---

## 不在范围

- 不实现 auth / 登录态 / role 权限（iter 18）
- 不做 API docs 实际内容（占位即可）
- 不实现 admin/users 后端 CRUD（占位）
- 不发起 PR

---

## 验收清单

- [ ] 访问 `/` 看到模板列表（mock 或真实数据）+ sidebar 显示
- [ ] 点 sidebar 「个人中心」→ 跳 `/me`，显示「开发中」占位
- [ ] 同样验证其他菜单项
- [ ] 点击 sidebar 折叠按钮 → 宽度变 56px、文字隐藏、icon 保留
- [ ] 刷新页面 → 折叠状态保留
- [ ] 访问 `/designer/new` → **sidebar 不出现**，编辑器全屏
- [ ] 访问 `/nonexistent` → 自动重定向到 `/404`
- [ ] 路由切换有平滑过渡（不闪烁）
