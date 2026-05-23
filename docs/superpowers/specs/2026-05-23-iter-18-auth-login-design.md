# Iteration 18 — Login + Feishu SSO + Auth Design

**Goal:** 实现完整登录链路：用户名密码登录 + 飞书 SSO 自动建账号 + Pinia 全局登录态 + 路由 guard。

**Scope:** 前后端。**前置依赖**：iter 17 已实现 AppShell + routes。

---

## 登录页 UI 设计

```
┌──────────────────────────────────────┐
│            模板打印平台              │
│                                      │
│   ┌────────────────────────────┐     │
│   │ 账号                       │     │
│   │ [______________________]   │     │
│   │                            │     │
│   │ 密码                       │     │
│   │ [______________________]   │     │
│   │                            │     │
│   │      [    登录    ]        │     │
│   │                            │     │
│   │ ────────  或  ────────     │     │
│   │                            │     │
│   │  🟢 [ 使用飞书账号登录 ]   │     │
│   └────────────────────────────┘     │
│                                      │
│  忘记密码？联系管理员                │
└──────────────────────────────────────┘
```

Route: `/login`。未登录用户访问任何 protected 路由 → 自动重定向到 `/login?redirect=<原路径>`，登录成功后跳回。

---

## 后端 Auth 模块

新建 `apps/api/src/auth/`：

```
auth/
├── auth.module.ts
├── auth.controller.ts       # POST /auth/login, /auth/logout, /auth/me, /auth/feishu/callback
├── auth.service.ts          # 密码哈希校验、token 发放、SSO 处理
├── jwt.strategy.ts          # JWT 验证 (passport-jwt)
└── guards/
    └── jwt-auth.guard.ts
```

### Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ username, password }` | `{ token, user: {id, username, role} }` |
| POST | `/auth/logout` | — | `{ ok: true }` |
| GET | `/auth/me` | (token in cookie/header) | `{ id, username, role, feishu_user_id? }` |
| GET | `/auth/feishu/start` | — | 302 redirect 到飞书 OAuth |
| GET | `/auth/feishu/callback` | `?code=...&state=...` | 302 redirect 到 `/login/sso-complete` 或 frontend redirect |

### User Schema (新增表)

`migrations/00X_create_users.sql`:

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT,                          -- nullable for SSO-only users
  feishu_user_id TEXT UNIQUE,                  -- bind to Feishu identity
  role          TEXT NOT NULL DEFAULT 'user',  -- 'user' / 'admin'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX idx_users_feishu ON users (feishu_user_id);
```

### 密码哈希

用 **bcrypt** (12 rounds)。`password_hash` 字段存哈希。

### 飞书 SSO 流程

1. 用户点 「使用飞书账号登录」 → 前端 `window.location = '/api/auth/feishu/start'`
2. 后端 redirect 到飞书 OAuth：`https://passport.feishu.cn/suite/passport/oauth/authorize?app_id=...&redirect_uri=<callback>&state=<csrf>`
3. 用户在飞书授权 → 飞书 redirect 回 `/api/auth/feishu/callback?code=...&state=...`
4. 后端用 code 换 access_token → 用 access_token 拉用户信息 → 拿到 `feishu_user_id` (open_id)
5. **查 users 表**：
   - 找到 → 登录该用户
   - 没找到 → **自动建账号**：
     - `username` = `feishu_${user_id}`
     - `password_hash` = bcrypt(随机 12 位密码)
     - `feishu_user_id` = 飞书 open_id
     - `role` = 'user'
     - **触发通知**：通过飞书 IM 给用户发一条 message：
       > 欢迎使用模板打印平台！您的初始密码是：`<随机密码>`，请尽快登录后修改密码。
6. 发 JWT cookie + redirect 回前端 `/login/sso-complete?token=<jwt>` → 前端把 token 存到 store + redirect 回原路径

### CSRF 防护

OAuth `state` 参数：登录前端生成随机 string 存到 sessionStorage，传给 `/auth/feishu/start`。callback 时校验 state 匹配。

### 配置（来自 .env）

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx               # 使用 credentialId 机制，不能直接放 .env
FEISHU_REDIRECT_URI=http://your-host/api/auth/feishu/callback
JWT_SECRET=<random 32-byte hex>
JWT_EXPIRES_IN=7d
```

注意 CLAUDE.md 指明：**飞书 API 调用方传 credentialId 而非明文 secret**。这意味着我们项目维护一个安全凭据存储（vault / secret-management），运行时通过 credentialId 取回真实 secret，不直接读 `.env`。**iter 18 需要先实现一个 SecretStore 抽象**（v1：从 env 读，v2：接入真正 vault）。

---

## 前端 Auth 模块

### `apps/web/src/stores/auth.ts` (new)

```ts
import { defineStore } from 'pinia';

interface User {
  id: string;
  username: string;
  role: 'user' | 'admin';
  feishu_user_id?: string;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('tp_auth_token'),
    user: null as User | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin',
  },
  actions: {
    async login(username: string, password: string) {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) throw new Error('登录失败');
      const data = await r.json();
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('tp_auth_token', data.token);
    },
    async loadMe() {
      if (!this.token) return;
      const r = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (r.ok) this.user = await r.json();
      else this.logout();
    },
    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem('tp_auth_token');
    },
  },
});
```

### Router Guard

```ts
// router.ts
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  
  // 未登录访问受保护路由
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  
  // role guard
  if (to.meta.adminOnly && !auth.isAdmin) {
    return { path: '/403' };
  }
  
  // 已登录但 user 信息没拉过
  if (auth.isLoggedIn && !auth.user) {
    await auth.loadMe();
  }
});
```

路由 meta：
```ts
{ path: '/', meta: { requiresAuth: true } },
{ path: '/me', meta: { requiresAuth: true } },
{ path: '/admin/users', meta: { requiresAuth: true, adminOnly: true } },
{ path: '/login', meta: { requiresAuth: false } },
```

### Sidebar 底部 + AppShell 集成

iter 17 留的 sidebar-foot 占位现在接入实际用户头像 + 名字 + 退出按钮。

```vue
<div class="sidebar-foot">
  <Avatar :name="auth.user?.username" />
  <span>{{ auth.user?.username }}</span>
  <button @click="auth.logout(); router.push('/login')">退出</button>
</div>
```

---

## 实施步骤（iter 18 内 ~10 task）

1. 后端：users table migration + ORM model
2. 后端：auth module + JWT strategy + bcrypt 密码哈希
3. 后端：`POST /auth/login` + `GET /auth/me` + `POST /auth/logout`
4. 后端：SecretStore 抽象 v1（env-based）
5. 后端：`/auth/feishu/start` + `/auth/feishu/callback` 完整 OAuth 流程
6. 后端：飞书 IM 通知服务（新账号密码推送）
7. 前端：auth.ts Pinia store
8. 前端：LoginView.vue + 飞书 SSO 按钮
9. 前端：router guard + meta
10. 前端：Sidebar 集成用户信息 + 退出
11. 测试：unit (bcrypt / JWT)、e2e (login flow / SSO 模拟)
12. 验收

---

## 验收清单

- [ ] 未登录访问 `/` → 重定向到 `/login`
- [ ] 用户名密码登录成功 → 跳回原路径或 `/`
- [ ] 错误密码 → 友好错误提示
- [ ] 登录后刷新页面 → 仍登录态（JWT 持久化）
- [ ] 飞书 SSO 按钮点击 → 跳飞书 → 授权 → 跳回 → 已登录
- [ ] 新飞书用户第一次登录 → 自动建账号 + 收到飞书 IM 密码通知
- [ ] 第二次 SSO 登录 → 直接登录（不重复建账号）
- [ ] 退出登录 → 跳 `/login` + 删 token
- [ ] 非 admin 访问 `/admin/users` → 跳 `/403`
- [ ] JWT 过期 (>7d) → `/auth/me` 401 → 自动 logout + 跳 `/login`

---

## 安全注意

- **密码哈希必须 bcrypt**（cost 12+），不要用 MD5/SHA1
- **JWT secret 至少 32 字节随机**，存到 SecretStore 不进 git
- **飞书 SSO 自动建的密码必须随机**（不允许硬编 123456）
- **CSRF state 必须校验**，防止恶意 OAuth callback
- **登录失败要限流**（同 IP / 同账号 5 次失败 → 15 分钟封禁）— 用 redis 计数
