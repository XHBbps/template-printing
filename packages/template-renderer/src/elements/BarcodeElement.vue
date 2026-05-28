<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick, inject } from 'vue';
import { renderSettleKey } from '../render-context';
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

// 渲染-settle ctx:仅非 designMode(打印渲染期)参与;设计器不 provide → null。
const settle = inject(renderSettleKey, null);
const active = () => (!props.designMode && settle ? settle : null);

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
}));

function render(): void {
  if (!hasContent.value) return;
  if (!canvasRef.value) return;
  const v = value.value;
  if (!v) return;
  const elPxW = props.element.anchor.w * 4; // PX_PER_MM = 4
  const elPxH = props.element.anchor.h * 4;
  // code128 ≈ 11 modules/char + quiet zone 20
  const estModules = v.length * 11 + 20;
  const scale = Math.max(1, Math.floor((elPxW * 0.85) / estModules));
  const height = Math.max(8, Math.floor(elPxH * 0.75));
  // begin/end 在同一次同步 render 内严格配平(bwip-js 同步);active() 一次求值复用到 finally。
  const ctx = active();
  ctx?.begin();
  try {
    bwipjs.toCanvas(canvasRef.value, {
      bcid: props.element.symbology,
      text: v,
      scale,
      height,
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[BarcodeElement] bwip-js render failed:', err);
    ctx?.reportError('barcode_invalid', String((err as Error)?.message ?? err));
  } finally {
    ctx?.end();
  }
}

watch(
  () => ({
    anchor: { ...props.element.anchor },
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
  async (next) => {
    if (next.isResizing) return;
    await nextTick();
    render();
  },
  { deep: true, immediate: true },
);

onMounted(() => {
  // Defensive: ensure first render fires after DOM commit even if the
  // immediate watch raced with mount.
  render();
});
</script>

<template>
  <div class="tp-barcode">
    <div v-if="props.isResizing" class="bc-placeholder">
      <span class="bc-icon">||||</span>
      <span class="bc-label">条码</span>
    </div>
    <div v-else class="bc-wrap" :style="wrapStyle">
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
.bc-placeholder {
  width: 100%;
  height: 100%;
  background: var(--tp-field-bg, #f5f5f5);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-soft, #555);
  font-size: 11px;
  gap: 4px;
}
.bc-icon {
  font-family: ui-monospace, monospace;
  font-size: 18px;
  letter-spacing: -2px;
  color: var(--tp-ink, #333);
}
.bc-label {
  font-size: 10px;
  color: var(--tp-ink-soft, #555);
}
</style>
