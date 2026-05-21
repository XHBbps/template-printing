<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import AppHeader from './components/AppHeader.vue';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
const route = useRoute();

// Designer pages have their own header — hide the global one to avoid double headers.
const showGlobalHeader = computed(() => !route.path.startsWith('/designer'));
</script>

<template>
  <AppHeader v-if="showGlobalHeader && (auth.user || !auth.loading)" />
  <RouterView />
</template>
