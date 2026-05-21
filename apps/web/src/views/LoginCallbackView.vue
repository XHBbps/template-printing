<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

onMounted(async () => {
  const csrf = route.query.csrf as string | undefined;
  if (csrf) authStore.csrf = csrf;
  await authStore.hydrate();
  await router.replace({ path: route.path, query: { ...route.query, csrf: undefined } });
});
</script>

<template>
  <main style="padding: 32px">
    <p>正在登录...</p>
  </main>
</template>
