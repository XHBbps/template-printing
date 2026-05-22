<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import { computed, ref } from 'vue';

import { useDesignerStore } from '../stores/designer';
import CanvasElement from './CanvasElement.vue';
import { buildElement, type ElementMeta } from './elementFactory';

const store = useDesignerStore();
const paperRef = ref<HTMLElement | null>(null);
const isDropTarget = ref(false);

const cssVars = computed(() => ({
  '--cell-w': `${store.template.canvas.cell.w}px`,
  '--cell-h': `${store.template.canvas.cell.h}px`,
  '--canvas-w': `${store.paperPx.w}px`,
  '--canvas-h': `${store.paperPx.h}px`,
}));

function clickPaperBackground(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('tp-paper')) {
    store.clearSelection();
  }
}

function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer) return;
  if (!Array.from(e.dataTransfer.types).includes('application/x-tp-element')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  isDropTarget.value = true;
}

function onDragLeave(e: DragEvent): void {
  // Only clear if leaving the paper itself (not bubble from child)
  if (e.target === paperRef.value) {
    isDropTarget.value = false;
  }
}

function onDrop(e: DragEvent): void {
  isDropTarget.value = false;
  if (!e.dataTransfer) return;
  const raw = e.dataTransfer.getData('application/x-tp-element');
  if (!raw) return;
  e.preventDefault();
  let meta: ElementMeta;
  try {
    meta = JSON.parse(raw) as ElementMeta;
  } catch {
    return;
  }
  if (!paperRef.value) return;
  const rect = paperRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const { w: cellW, h: cellH } = store.template.canvas.cell;
  const { cols, rows } = store.template.canvas;
  // Snap to cell, centered on cursor
  let c = Math.floor(x / cellW) - Math.floor(meta.defaultGrid.cs / 2);
  let r = Math.floor(y / cellH) - Math.floor(meta.defaultGrid.rs / 2);
  c = Math.max(0, Math.min(cols - meta.defaultGrid.cs, c));
  r = Math.max(0, Math.min(rows - meta.defaultGrid.rs, r));
  const el: TemplateElement = buildElement(meta, store.newElementId(), c, r);
  store.addElement(el);
}
</script>

<template>
  <div class="tp-canvas-area">
    <div
      ref="paperRef"
      class="tp-paper"
      :class="{
        'is-dragging': store.isResizing,
        'is-drop-target': isDropTarget,
        heavy: store.template.elements.length > 500,
      }"
      :style="{
        ...cssVars,
        width: 'var(--canvas-w)',
        height: 'var(--canvas-h)',
      }"
      @click="clickPaperBackground"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <CanvasElement v-for="el in store.template.elements" :key="el.id" :element="el" />
    </div>
  </div>
</template>
