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
      path: '/:pathMatch(.*)*',
      redirect: '/404',
    },
  ],
});

let hasHydratedOnce = false;

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // First-time hydrate on app boot (always).
  // Re-hydrate when entering a protected route with unknown auth (catches
  // bfcache restore where module state persists but session may have changed).
  const shouldHydrate = !hasHydratedOnce || (to.meta.requiresAuth && !auth.isAuthenticated);
  if (shouldHydrate) {
    await auth.hydrate();
    hasHydratedOnce = true;
  }
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
