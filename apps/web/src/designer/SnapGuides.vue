<script setup lang="ts">
import { computed } from 'vue';
import { useDesignerStore } from '../stores/designer';

interface Guides {
  v: number[];
  h: number[];
  distLabels: Array<{ kind: 'h' | 'v'; a: number; b: number; crossAxis: number; value: number }>;
}

const props = defineProps<{ guides: Guides }>();
const store = useDesignerStore();

const PX_PER_MM = 4;

function mmToCanvasPx(mm: number): number {
  return mm * PX_PER_MM * store.view.zoom;
}

const verticalLines = computed(() =>
  props.guides.v.map((mmX) => ({ left: `${mmToCanvasPx(mmX)}px` })),
);

const horizontalLines = computed(() =>
  props.guides.h.map((mmY) => ({ top: `${mmToCanvasPx(mmY)}px` })),
);

const labels = computed(() =>
  props.guides.distLabels.map((d) => {
    const aPx = mmToCanvasPx(d.a);
    const bPx = mmToCanvasPx(d.b);
    const crossPx = mmToCanvasPx(d.crossAxis);
    if (d.kind === 'h') {
      return {
        style: {
          left: `${aPx + (bPx - aPx) / 2}px`,
          top: `${crossPx}px`,
          transform: 'translate(-50%, -50%)',
        },
        value: d.value,
      };
    }
    return {
      style: {
        left: `${crossPx}px`,
        top: `${aPx + (bPx - aPx) / 2}px`,
        transform: 'translate(-50%, -50%)',
      },
      value: d.value,
    };
  }),
);
</script>

<template>
  <div class="sg-layer">
    <div v-for="(s, i) in verticalLines" :key="`v${i}`" class="sg-v" :style="s" />
    <div v-for="(s, i) in horizontalLines" :key="`h${i}`" class="sg-h" :style="s" />
    <div v-for="(l, i) in labels" :key="`l${i}`" class="sg-label" :style="l.style">
      {{ Math.round(l.value) }} mm
    </div>
  </div>
</template>

<style scoped>
.sg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.sg-v {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--tp-accent);
  box-shadow: 0 0 12px rgba(108, 92, 231, 0.3);
}
.sg-h {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--tp-accent);
  box-shadow: 0 0 12px rgba(108, 92, 231, 0.3);
}
.sg-label {
  position: absolute;
  background: var(--tp-accent);
  color: #fff;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.4;
  white-space: nowrap;
}
</style>
