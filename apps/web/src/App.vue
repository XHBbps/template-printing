<script setup lang="ts">
import { useAuthStore } from './stores/auth';

import AppHeader from './components/AppHeader.vue';

const auth = useAuthStore();
</script>

<template>
  <AppHeader v-if="auth.user || !auth.loading" />
  <RouterView />
</template>
