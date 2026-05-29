// eslint-disable-next-line import/no-unresolved
import { createRouter, createWebHistory } from 'vue-router';

import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: '/templates',
    },
    {
      path: '/templates',
      name: 'templates',
      meta: { requiresAuth: true },
      component: () => import('../views/TemplatesView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/login/callback',
      name: 'login-callback',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/LoginCallbackView.vue'),
    },
    // Legacy direct designer URLs — redirect to templates with query so TemplatesView opens that one inline
    {
      path: '/designer/new',
      redirect: '/templates?new=1',
    },
    {
      path: '/designer/:id',
      redirect: (to) => `/templates?open=${to.params.id as string}`,
    },
    {
      path: '/me',
      name: 'me',
      meta: { requiresAuth: true },
      component: () => import('../views/MeView.vue'),
    },
    // iter 30B: ApiTokens 合并入 /api 文档（方案 A），保留路由作为重定向防外链断裂
    {
      path: '/me/api-tokens',
      redirect: '/api?to=tokens',
    },
    {
      path: '/logs',
      name: 'render-logs',
      meta: { requiresAuth: true },
      component: () => import('../views/RenderLogsView.vue'),
    },
    {
      path: '/api',
      name: 'api',
      meta: { requiresAuth: true },
      component: () => import('../views/ApiView.vue'),
    },
    // 历史 URL 兼容：/api-docs → /api
    {
      path: '/api-docs',
      redirect: '/api',
    },
    {
      path: '/print-headless/:id',
      name: 'print-headless',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/PrintHeadlessView.vue'),
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      meta: { requiresAuth: true, adminOnly: true },
      component: () => import('../views/admin/UsersAdminView.vue'),
    },
    {
      path: '/admin/audit',
      name: 'admin-audit',
      meta: { requiresAuth: true, adminOnly: true },
      component: () => import('../views/admin/AuditLogView.vue'),
    },
    {
      path: '/401',
      name: 'unauthorized',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/errors/UnauthorizedView.vue'),
    },
    {
      path: '/403',
      name: 'forbidden',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/errors/ForbiddenView.vue'),
    },
    {
      path: '/404',
      name: 'not-found',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/errors/NotFoundView.vue'),
    },
    {
      path: '/500',
      name: 'server-error',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/errors/ServerErrorView.vue'),
    },
    {
      // 直接渲染 404 视图（不 redirect 到 /404），保留用户输入的原始 URL，
      // 便于错误页用 window.location.pathname 显示实际访问路径
      path: '/:pathMatch(.*)*',
      name: 'not-found-catchall',
      meta: { requiresAuth: false, fullscreen: true },
      component: () => import('../views/errors/NotFoundView.vue'),
    },
  ],
});

let hasHydratedOnce = false;

// 注意:此 guard 不再 async/await。首屏 boot 时把 hydrate 放后台跑,立即放行,
// 由 AppShell 的全屏骨架遮住 RouterView(防未授权内容外泄),hydrate 完成后
// 再由 AppShell 的 enforceAfterHydrate() 纠正重定向。详见 AppShell.vue。
router.beforeEach((to) => {
  // 渲染页(headless 浏览器)只渲染注入的 __renderInput、永不需要鉴权 —— 直接放行,
  // 跳过 boot 期 hydrate,避免无 cookie 时 GET /users/me（及其 401 触发的 /auth/refresh）
  // 产生 401 噪声 + 无用请求。该路由 requiresAuth:false 且无 adminOnly,早返回不绕过任何实际守卫。
  if (to.name === 'print-headless') return true;
  const auth = useAuthStore();
  // First navigation on app boot: kick off hydrate in the background (no await)
  // and optimistically allow the navigation. The boot skeleton in AppShell
  // covers RouterView until hydrate settles, then enforceAfterHydrate() fixes
  // any required redirect. This avoids blocking the first paint on 1–3 RTTs.
  if (!hasHydratedOnce) {
    hasHydratedOnce = true;
    void auth.hydrate();
    return true;
  }
  // Subsequent navigations: synchronous enforcement against known auth state.
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { continue: to.fullPath } };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/templates' };
  }
  if (to.meta.adminOnly) {
    const role = auth.user?.role;
    if (role !== 'admin' && role !== 'emergency_admin') {
      return { path: '/403' };
    }
  }
  return true;
});

export default router;
