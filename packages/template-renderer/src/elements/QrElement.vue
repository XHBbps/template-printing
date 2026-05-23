<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed, ref, watch, onMounted, nextTick } from 'vue';
// eslint-disable-next-line import/no-unresolved
import qrcode from 'qrcode-generator';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'qr' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  isResizing?: boolean;
}>();

const qrSvg = ref('');

const contentText = computed(() => {
  if (props.element.binding) {
    const v = props.data?.[props.element.binding];
    return v == null ? '' : String(v);
  }
  return props.element.content?.static ?? '';
});

const hasContent = computed(() => contentText.value !== '');

const wrapStyle = computed(() => ({
  width: '100%',
  height: '100%',
  position: 'relative' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

function render(): void {
  if (!hasContent.value) {
    qrSvg.value = '';
    return;
  }
  try {
    const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;
    const ecc = (props.element.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H';
    const qr = qrcode(0, eccMap[ecc]);
    qr.addData(contentText.value);
    qr.make();
    const cellSize = 4;
    const margin = props.element.quietZone ?? 2;
    qrSvg.value = qr.createSvgTag({ cellSize, margin });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[QrElement] qrcode render failed:', err);
    qrSvg.value = '';
  }
}

watch(
  () => ({
    grid: props.element.grid,
    content: props.element.content,
    binding: props.element.binding,
    ecc: props.element.eccLevel,
    fg: props.element.foregroundColor,
    bg: props.element.backgroundColor,
    qz: props.element.quietZone,
    isResizing: props.isResizing,
  }),
  async (next) => {
    if (next.isResizing) return;
    await nextTick();
    render();
  },
  { deep: true, immediate: true },
);

onMounted(() => {
  render();
});
</script>

<template>
  <div v-if="props.isResizing" class="qr-placeholder">
    <div class="qr-icon">▦</div>
    <span class="qr-label">二维码</span>
  </div>
  <div v-else class="qr-wrap" :style="wrapStyle">
    <div
      v-if="hasContent"
      class="qr-svg"
      :style="{ color: props.element.foregroundColor, background: props.element.backgroundColor }"
      v-html="qrSvg"
    />
    <div v-else class="qr-empty">未配置内容</div>
  </div>
</template>

<style scoped>
.qr-svg {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr-svg :deep(svg) {
  width: 100%;
  height: 100%;
}
.qr-empty {
  width: 100%;
  height: 100%;
  border: 1px dashed var(--tp-line-strong, #e0e0e4);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-faint, #9c9ca3);
  font-size: 11px;
}
.qr-placeholder {
  width: 100%;
  height: 100%;
  background: var(--tp-field-bg, #f5f5f5);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.qr-icon {
  font-size: 28px;
  color: var(--tp-ink, #333);
  line-height: 1;
}
.qr-label {
  font-size: 10px;
  color: var(--tp-ink-soft, #555);
}
</style>
