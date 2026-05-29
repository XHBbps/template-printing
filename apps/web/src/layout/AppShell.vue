<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import MustChangePasswordDialog from '../components/MustChangePasswordDialog.vue';
import AppSidebar from './AppSidebar.vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const isFullscreen = computed(() => Boolean(route.meta.fullscreen));
const collapsed = ref(localStorage.getItem('tp_sidebar_collapsed') === 'true');

// Boot skeleton: while the very first hydrate is still in flight (loading &&
// !hydrated), cover RouterView with a full-screen skeleton so no protected
// content can ever leak before auth is known. Once hydrate settles,
// enforceAfterHydrate() corrects any redirect.
// - Normal app pages (non-fullscreen) always show the skeleton during boot.
// - /login is shown via skeleton too during boot: an already-logged-in user
//   would otherwise see a flash of the login form before being redirected to
//   /templates. Other fullscreen pages (callback / print / error pages) are
//   requiresAuth:false and don't depend on hydrate, so render normally.
const showBootSkeleton = computed(() => {
  if (!auth.loading || auth.hydrated) return false;
  return !isFullscreen.value || route.path === '/login';
});

// Whenever auth becomes null while on a protected route, evict to /login.
// Covers: session expiry, logout from another tab, refresh-token failure.
watch(
  () => auth.user,
  (u, prev) => {
    if (prev && !u && route.meta.requiresAuth) {
      void router.push({ path: '/login', query: { continue: route.fullPath } });
    }
  },
);

// After the first boot hydrate settles (loading: true -> false), correct the
// optimistic navigation that the router allowed through during boot. Mirrors
// the synchronous enforcement in router/index.ts beforeEach.
function enforceAfterHydrate(): void {
  const r = route;
  if (r.meta.requiresAuth && !auth.isAuthenticated) {
    void router.replace({ path: '/login', query: { continue: r.fullPath } });
    return;
  }
  if (r.path === '/login' && auth.isAuthenticated) {
    // 尊重 ?continue= 回跳目标(与 LoginView 提交后的 push 一致),避免本地登录时
    // 本纠正与 LoginView 的导航竞态落到不同目标。无 continue 则回模板中心。
    const cont = typeof r.query.continue === 'string' ? r.query.continue : '/templates';
    void router.replace(cont);
    return;
  }
  if (r.meta.adminOnly) {
    const role = auth.user?.role;
    if (role !== 'admin' && role !== 'emergency_admin') {
      void router.replace({ path: '/403' });
    }
  }
}

watch(
  () => auth.loading,
  (loading) => {
    // Fires when hydrate finishes (true -> false). hydrated guards against any
    // later hydrate (bfcache / re-hydrate) re-running boot-time enforcement.
    if (!loading && auth.hydrated) enforceAfterHydrate();
  },
);

// bfcache: when the page is restored from back-forward cache, force re-hydrate
// so we don't trust stale module-level state.
function onPageShow(ev: PageTransitionEvent): void {
  if (ev.persisted) {
    void auth.hydrate();
  }
}
onMounted(() => window.addEventListener('pageshow', onPageShow));
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow));
</script>

<template>
  <!-- Boot skeleton: replaces the entire shell (sidebar + RouterView) while the
       first hydrate is in flight, so neither protected content nor the login
       form leaks before auth is known. -->
  <div v-if="showBootSkeleton" class="app-boot">
    <div class="app-boot__inner">
      <div class="app-boot__logo">兼</div>
      <div class="app-boot__spinner" aria-hidden="true"></div>
      <p class="app-boot__text">正在加载…</p>
    </div>
  </div>
  <div v-else class="app-shell">
    <AppSidebar v-if="!isFullscreen" v-model:collapsed="collapsed" />
    <main class="app-main" :class="{ 'app-main--full': isFullscreen }">
      <RouterView />
    </main>
    <!-- 仅在常规应用页(非全屏:登录/回调/打印/401/403/404/500)上叠加首登改密弹窗;
         否则会浮在 404 等错误页上。改密入口在真实页面保留,错误页点"回到模板中心"即恢复。 -->
    <MustChangePasswordDialog v-if="!isFullscreen" />
  </div>
</template>

<style scoped>
.app-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  width: 100vw;
  background: var(--mist);
}
.app-boot__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.app-boot__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--ink);
  color: var(--paper-white);
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}
.app-boot__spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2.5px solid rgba(0, 0, 0, 0.12);
  border-top-color: var(--accent);
  animation: app-boot-spin 0.7s linear infinite;
}
.app-boot__text {
  margin: 0;
  font-size: 14px;
  color: var(--ink);
  opacity: 0.6;
}
@keyframes app-boot-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-boot__spinner {
    animation: none;
  }
}
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.app-main {
  flex: 1;
  overflow: auto;
  background: var(--mist);
}
.app-main--full {
  background: transparent;
}
</style>
