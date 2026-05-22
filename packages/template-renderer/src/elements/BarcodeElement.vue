<script setup lang="ts">
import { computed, ref, watch } from 'vue';
// bwip-js uses conditional exports (browser/node/electron/react-native) that
// vue-tsc cannot resolve with moduleResolution=Bundler. Vite picks the browser
// bundle correctly at runtime. Suppress the TS module-not-found error here.
// @ts-expect-error -- conditional exports not resolved by vue-tsc
// eslint-disable-next-line import/no-unresolved
import bwipjs from 'bwip-js';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'barcode' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  isResizing?: boolean;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);

const value = computed<string>(() => {
  if (props.element.content?.static) return props.element.content.static;
  if (props.element.binding) {
    const v = props.data?.[props.element.binding];
    if (v != null) return String(v);
  }
  return props.designMode ? 'SAMPLE-CODE' : '';
});

const hasContent = computed(() => {
  const c = props.element.content?.static;
  const b = props.element.binding;
  return (c !== undefined && c !== '') || (b !== undefined && b !== '');
});

const wrapStyle = computed(() => ({
  width: '100%',
  height: '100%',
  position: 'relative' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  filter: props.isResizing ? 'blur(2px) opacity(0.55)' : 'none',
  transition: 'filter 120ms ease',
}));

function render(): void {
  if (!hasContent.value) return;
  if (!canvasRef.value) return;
  const v = value.value;
  if (!v) return;
  try {
    bwipjs.toCanvas(canvasRef.value, {
      bcid: props.element.symbology,
      text: v,
      scale: 3,
      height: 12,
      includetext: props.element.showText ?? false,
      textxalign: 'center',
      paddingwidth: props.element.quietZone ?? 4,
      textgaps: 2,
      textsize: props.element.textFontSize ?? 10,
      textyoffset:
        props.element.textPosition === 'top' ? -((props.element.textFontSize ?? 10) + 2) : 0,
      barcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
      backgroundcolor: (props.element.backgroundColor ?? '#ffffff').replace('#', ''),
      textcolor: (props.element.foregroundColor ?? '#000000').replace('#', ''),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('barcode render failed', e);
  }
}

watch(
  () => ({
    grid: props.element.grid,
    sym: props.element.symbology,
    content: props.element.content,
    binding: props.element.binding,
    fg: props.element.foregroundColor,
    bg: props.element.backgroundColor,
    qz: props.element.quietZone,
    showText: props.element.showText,
    tpos: props.element.textPosition,
    tfs: props.element.textFontSize,
    isResizing: props.isResizing,
  }),
  (next) => {
    if (next.isResizing) return; // skip during drag
    render();
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <div class="tp-barcode">
    <div class="bc-wrap" :style="wrapStyle">
      <canvas v-if="hasContent" ref="canvasRef" class="tp-canvas" />
      <div v-else class="bc-empty">未配置内容</div>
    </div>
  </div>
</template>

<style scoped>
.tp-barcode {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bc-wrap :deep(canvas),
.bc-wrap canvas {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
.tp-canvas {
  max-width: 100%;
  max-height: 100%;
}
.bc-empty {
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
</style>
