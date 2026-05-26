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
  <div class="app-shell">
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
