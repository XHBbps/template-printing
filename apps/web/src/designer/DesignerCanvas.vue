<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { useDesignerStore } from '../stores/designer';
import CanvasElement from './CanvasElement.vue';
import { buildElement, type ElementMeta } from './elementFactory';

const store = useDesignerStore();
const paperRef = ref<HTMLElement | null>(null);
const isDropTarget = ref(false);

const cssVars = computed(() => {
  const z = store.view.zoom;
  const px = store.paperPx;
  return {
    '--cell-w': `${store.template.canvas.cell.w * z}px`,
    '--cell-h': `${store.template.canvas.cell.h * z}px`,
    '--canvas-w': `${px.w * z}px`,
    '--canvas-h': `${px.h * z}px`,
  };
});

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
  e.preventDefault();
  isDropTarget.value = false;
  if (!e.dataTransfer) return;
  const raw = e.dataTransfer.getData('application/x-tp-element');
  if (!raw) return;
  let meta: ElementMeta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return;
  }
  if (!paperRef.value) return;

  const rect = paperRef.value.getBoundingClientRect();
  const zoom = store.view.zoom;
  const PX_PER_MM = 4;
  const cursorMmX = (e.clientX - rect.left) / (PX_PER_MM * zoom);
  const cursorMmY = (e.clientY - rect.top) / (PX_PER_MM * zoom);

  const paperPx = store.paperPx;
  const paperMm = { w: paperPx.w / PX_PER_MM, h: paperPx.h / PX_PER_MM };

  const anchorMm = {
    x: Math.max(0, Math.min(paperMm.w - meta.defaultMm.w, cursorMmX - meta.defaultMm.w / 2)),
    y: Math.max(0, Math.min(paperMm.h - meta.defaultMm.h, cursorMmY - meta.defaultMm.h / 2)),
  };

  const el = buildElement(meta, store.newElementId(), anchorMm, store.template.canvas.cell);
  store.addElement(el);
}

const canvasAreaRef = ref<HTMLElement | null>(null);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  store.registerCanvasArea(() => {
    const el = canvasAreaRef.value;
    if (!el) return { w: 800, h: 600 };
    return { w: el.clientWidth, h: el.clientHeight };
  });
  // Initial fit after mount + first paint.
  requestAnimationFrame(() => store.fitView());

  if (canvasAreaRef.value && typeof ResizeObserver !== 'undefined') {
    let raf = 0;
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => store.fitView());
    });
    resizeObserver.observe(canvasAreaRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="canvasAreaRef" class="tp-canvas-area">
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
