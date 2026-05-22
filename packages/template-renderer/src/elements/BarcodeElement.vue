<script setup lang="ts">
import { computed, ref, watch } from 'vue';
// bwip-js uses conditional exports (browser/node/electron/react-native) that
// vue-tsc cannot resolve with moduleResolution=Bundler. Vite picks the browser
// bundle correctly at runtime. Suppress the TS module-not-found error here.
// @ts-expect-error -- conditional exports not resolved by vue-tsc
// eslint-disable-next-line import/no-unresolved
import bwipjs from 'bwip-js';
// eslint-disable-next-line import/no-unresolved
import qrcode from 'qrcode-generator';

// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const props = defineProps<{
  element: Extract<TemplateElement, { type: 'barcode' }>;
  data?: Record<string, unknown>;
  designMode?: boolean;
  isResizing?: boolean;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const qrSvg = ref<string>('');

const value = computed<string>(() => {
  if (props.element.content?.static) return props.element.content.static;
  if (props.element.binding) {
    const v = props.data?.[props.element.binding];
    if (v != null) return String(v);
  }
  return props.designMode ? 'SAMPLE-CODE' : '';
});

const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;

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
  const v = value.value;
  if (!v) return;
  if (props.element.symbology === 'qr') {
    // qrcode-generator produces SVG inline
    const ecc = (props.element.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H';
    const qr = qrcode(0, eccMap[ecc]);
    qr.addData(v);
    qr.make();
    const cellSize = 4;
    const margin = props.element.quietZone ?? 2;
    qrSvg.value = qr.createSvgTag({ cellSize, margin });
    // Apply foreground/background colors via CSS filter or inline style on the wrapper
  } else {
    if (!canvasRef.value) return;
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
}

watch(
  () => ({
    grid: props.element.grid,
    sym: props.element.symbology,
    content: props.element.content,
    binding: props.element.binding,
    ecc: props.element.eccLevel,
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
      <div
        v-if="props.element.symbology === 'qr'"
        class="tp-qr"
        :style="{
          color: props.element.foregroundColor ?? '#000000',
          background: props.element.backgroundColor ?? '#ffffff',
        }"
        v-html="qrSvg"
      />
      <canvas v-else ref="canvasRef" class="tp-canvas" />
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
.bc-wrap canvas,
.bc-wrap :deep(svg),
.bc-wrap svg {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
.tp-qr {
  width: 100%;
  height: 100%;
}
.tp-qr :deep(svg) {
  width: 100%;
  height: 100%;
}
.tp-canvas {
  max-width: 100%;
  max-height: 100%;
}
</style>
