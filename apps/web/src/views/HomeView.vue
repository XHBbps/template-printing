<script setup lang="ts">
import { ElButton } from 'element-plus';
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

onMounted(async () => {
  const csrf = route.query.csrf as string | undefined;
  if (csrf) {
    auth.csrf = csrf;
    await auth.hydrate();
    await router.replace({ path: route.path, query: { ...route.query, csrf: undefined } });
  }
});

function newTemplate(): void {
  router.push('/designer/new');
}
</script>

<template>
  <main style="padding: 32px">
    <h1>欢迎回来{{ auth.user?.name ? `, ${auth.user.name}` : '' }}</h1>
    <p>设计器 + 模板中心将在 Plan 2 + Plan 3 中实现。</p>
    <ElButton type="primary" size="large" @click="newTemplate">+ 新建模板</ElButton>
  </main>
</template>
