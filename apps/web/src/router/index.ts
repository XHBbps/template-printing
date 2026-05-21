import { createRouter, createWebHistory } from 'vue-router';

import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      meta: { requiresAuth: true },
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      meta: { requiresAuth: false },
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/designer/new',
      name: 'designer-new',
      meta: { requiresAuth: true },
      component: () => import('../views/DesignerView.vue'),
    },
    {
      path: '/designer/:id',
      name: 'designer-edit',
      meta: { requiresAuth: true },
      component: () => import('../views/DesignerView.vue'),
    },
    {
      path: '/login/callback',
      name: 'login-callback',
      meta: { requiresAuth: false },
      component: () => import('../views/LoginCallbackView.vue'),
    },
  ],
});

let hydrated = false;

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!hydrated) {
    await auth.hydrate();
    hydrated = true;
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { continue: to.fullPath } };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/' };
  }
  return true;
});

export default router;
