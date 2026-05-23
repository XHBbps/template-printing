<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { computed } from 'vue';

import AppSidebar from './AppSidebar.vue';

const route = useRoute();
const isFullscreen = computed(() => Boolean(route.meta.fullscreen));

const collapsed = ref(localStorage.getItem('tp_sidebar_collapsed') === 'true');
</script>

<template>
  <div class="app-shell">
    <AppSidebar v-if="!isFullscreen" v-model:collapsed="collapsed" />
    <main class="app-main" :class="{ 'app-main--full': isFullscreen }">
      <RouterView />
    </main>
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
  background: #f4f4f7;
}
.app-main--full {
  background: transparent;
}
</style>
