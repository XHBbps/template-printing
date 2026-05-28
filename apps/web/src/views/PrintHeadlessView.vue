<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import {
  TemplateRenderer,
  renderSettleKey,
  type RenderSettleCtx,
} from '@template-printing/template-renderer';
import { ref, onMounted, nextTick, provide, onErrorCaptured } from 'vue';
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
    __renderError?: { permanent: boolean; reason: string; detail?: string };
  }
}

const template = ref<Template | null>(null);
const data = ref<Record<string, unknown>>({});
const ready = ref(false);

// 渲染-settle 注册表:异步元件挂载/发起异步操作时 begin(),结算时 end()。
// __renderReady 只在 pending===0(全部结算)或安全超时后置位,取代固定 50ms 心跳。
const pending = ref(0);
const settleCtx: RenderSettleCtx = {
  begin: () => {
    pending.value++;
  },
  end: () => {
    pending.value = Math.max(0, pending.value - 1);
  },
  reportError: (reason: string, detail?: string) => {
    window.__renderError = { permanent: true, reason, detail };
  },
};
provide(renderSettleKey, settleCtx);
onErrorCaptured((err) => {
  settleCtx.reportError('render_error', (err as Error).message);
  return false; // 阻止继续向上传播,页面不崩
});

// Wait for the worker (puppeteer) to inject window.__renderInput via page.evaluate.
// The worker calls evaluate AFTER goto, so we poll briefly.
onMounted(() => {
  const startedAt = Date.now();
  const poll = (): void => {
    if (window.__renderInput) {
      template.value = window.__renderInput.template;
      data.value = window.__renderInput.data;
      void nextTick().then(() => {
        const waitSettle = (): void => {
          const timedOut = Date.now() - startedAt > 8000;
          if (pending.value === 0 || timedOut) {
            ready.value = true;
            window.__renderReady = true;
            // eslint-disable-next-line no-console
            console.log(`[ph] ready (pending=${pending.value}, timedOut=${timedOut})`); // diagnostic — kept so worker stdout sees the signal
          } else {
            setTimeout(waitSettle, 50);
          }
        };
        setTimeout(waitSettle, 50); // 给同步/即时元件一帧起步,再开始等结算
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
