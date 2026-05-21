<script setup lang="ts">
import { ref, onMounted } from 'vue';

const apiStatus = ref<'loading' | 'ok' | 'fail'>('loading');
const apiVersion = ref<string>('');

onMounted(async () => {
  try {
    const res = await fetch('/api/healthz');
    const body = await res.json();
    apiStatus.value = body.ok ? 'ok' : 'fail';
    apiVersion.value = body.version ?? '';
  } catch {
    apiStatus.value = 'fail';
  }
});
</script>

<template>
  <main style="padding: 32px; font-family: system-ui, sans-serif">
    <h1>模板打印平台</h1>
    <p>Scaffold up. Real UI lands in Plan 2 + Plan 3.</p>
    <p>
      API health:
      <strong v-if="apiStatus === 'loading'">…</strong>
      <strong v-else-if="apiStatus === 'ok'" style="color: green">OK ({{ apiVersion }})</strong>
      <strong v-else style="color: red">FAIL</strong>
    </p>
  </main>
</template>
