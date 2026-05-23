<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { TemplateRenderer } from '@template-printing/template-renderer';
import { ref, onMounted } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { Template } from '@template-printing/schema';

interface RenderInput {
  template: Template;
  data: Record<string, unknown>;
}
declare global {
  interface Window {
    __renderInput?: RenderInput;
    __renderReady?: boolean;
  }
}

const template = ref<Template | null>(null);
const data = ref<Record<string, unknown>>({});
const ready = ref(false);

// Wait for the worker (puppeteer) to inject window.__renderInput via page.evaluate.
// The worker calls evaluate AFTER goto, so we poll briefly.
onMounted(() => {
  const poll = (): void => {
    if (window.__renderInput) {
      template.value = window.__renderInput.template;
      data.value = window.__renderInput.data;
      // Allow Vue to render, then signal puppeteer to take screenshot/PDF.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ready.value = true;
          window.__renderReady = true;
        });
      });
    } else {
      setTimeout(poll, 50);
    }
  };
  poll();
});
</script>

<template>
  <div class="ph-host" :class="{ 'ph-host--ready': ready }">
    <TemplateRenderer v-if="template" :template="template" :data="data" />
  </div>
</template>

<style scoped>
.ph-host {
  background: #fff;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
/* Hide all UI chrome that might leak from global styles */
</style>

<style>
/* Global overrides for headless mode — ensure no scrollbars, no body padding */
html,
body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  overflow: hidden !important;
}
</style>
