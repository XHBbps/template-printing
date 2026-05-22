<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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

const showPlaceholder = computed(() => props.isResizing === true);
const isQr = computed(() => props.element.symbology === 'qr');

const eccMap = { L: 'L', M: 'M', Q: 'Q', H: 'H' } as const;

function render(): void {
  const v = value.value;
  if (!v) return;
  if (props.element.symbology === 'qr') {
    // qrcode-generator produces SVG inline
    const qr = qrcode(0, eccMap[props.element.eccLevel ?? 'M']);
    qr.addData(v);
    qr.make();
    const margin = props.element.quietZone ?? 2;
    qrSvg.value = qr.createSvgTag({ scalable: true, margin });
    // Apply foreground/background colors via CSS filter or inline style on the wrapper
  } else {
    if (!canvasRef.value) return;
    try {
      bwipjs.toCanvas(canvasRef.value, {
        bcid: props.element.symbology,
        text: v,
        scale: 2,
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

onMounted(render);
watch(
  () => [
    value.value,
    props.element.symbology,
    props.element.eccLevel,
    props.element.foregroundColor,
    props.element.backgroundColor,
    props.element.quietZone,
    props.element.textPosition,
    props.element.textFontSize,
    props.element.showText,
  ],
  render,
);
</script>

<template>
  <div class="tp-barcode">
    <template v-if="!showPlaceholder">
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
    </template>
    <div v-else class="bc-placeholder" :class="{ 'is-qr': isQr }" />
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
.bc-placeholder {
  width: 100%;
  height: 100%;
  background-color: #fff;
}
.bc-placeholder.is-qr {
  background-image: linear-gradient(45deg, #1f1f23 25%, transparent 25%),
    linear-gradient(-45deg, #1f1f23 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1f1f23 75%),
    linear-gradient(-45deg, transparent 75%, #1f1f23 75%);
  background-size: 8px 8px;
  background-position:
    0 0,
    0 4px,
    4px -4px,
    -4px 0;
}
.bc-placeholder:not(.is-qr) {
  background-image: repeating-linear-gradient(
    90deg,
    #1f1f23 0,
    #1f1f23 2px,
    transparent 2px,
    transparent 5px
  );
}
</style>
