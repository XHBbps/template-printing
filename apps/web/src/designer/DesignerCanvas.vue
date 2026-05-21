<script setup lang="ts">
import { computed } from 'vue';

import { useDesignerStore } from '../stores/designer';
import CanvasElement from './CanvasElement.vue';

const store = useDesignerStore();

const cssVars = computed(() => ({
  '--cell-w': `${store.template.canvas.cell.w}px`,
  '--cell-h': `${store.template.canvas.cell.h}px`,
  '--canvas-w': `${store.template.canvas.cell.w * store.template.canvas.cols}px`,
  '--canvas-h': `${store.template.canvas.cell.h * store.template.canvas.rows}px`,
}));

function clickPaperBackground(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('designer-paper')) {
    store.clearSelection();
  }
}
</script>

<template>
  <section class="designer-middle">
    <div
      class="designer-paper"
      :class="{
        'is-dragging': store.isResizing,
        heavy: store.template.elements.length > 500,
      }"
      :style="{
        ...cssVars,
        width: 'var(--canvas-w)',
        height: 'var(--canvas-h)',
      }"
      @click="clickPaperBackground"
    >
      <CanvasElement v-for="el in store.template.elements" :key="el.id" :element="el" />
    </div>
  </section>
</template>
