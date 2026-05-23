<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { useDesignerStore } from '../stores/designer';
import CanvasElement from './CanvasElement.vue';
import CanvasFloatingToolbar from './CanvasFloatingToolbar.vue';
import { buildElement, type ElementMeta } from './elementFactory';
import SnapGuides from './SnapGuides.vue';

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

const canvasAreaStyle = computed(() => {
  if (store.panMode) {
    return { cursor: 'grab' };
  }
  return {};
});

function onCanvasPointerDown(e: PointerEvent): void {
  if (!store.panMode) return;
  // Only pan when clicking the canvas itself (not an element handle)
  const ca: HTMLElement | null = canvasAreaRef.value;
  if (!ca) return;
  const target: HTMLElement = ca;
  e.preventDefault();
  e.stopPropagation();

  let lastX = e.clientX;
  let lastY = e.clientY;
  target.style.cursor = 'grabbing';

  function onMove(ev: PointerEvent): void {
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    target.scrollLeft -= dx;
    target.scrollTop -= dy;
    lastX = ev.clientX;
    lastY = ev.clientY;
  }
  function onUp(): void {
    target.style.cursor = 'grab';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

onMounted(() => {
  store.registerCanvasArea(() => {
    const el = canvasAreaRef.value;
    if (!el) return { w: 800, h: 600 };
    return { w: el.clientWidth, h: el.clientHeight };
  });
  // Initial fit after mount + first paint.
  requestAnimationFrame(() => store.fitView());
  // NOTE: Removed the ResizeObserver auto-fit. When the user manually sets
  // zoom > fit (e.g. 150%), the paper overflows and a scrollbar appears inside
  // .tp-canvas-area, which shrinks its contentBoxSize. ResizeObserver fires →
  // fitView snaps zoom back down → user can never zoom above fit.
  // Now: zoom is sticky. User must click the "Fit" toolbar button to re-fit.
});
</script>

<template>
  <div
    ref="canvasAreaRef"
    class="tp-canvas-area"
    :class="{ 'tp-canvas-area--pan': store.panMode }"
    :style="canvasAreaStyle"
    @pointerdown="onCanvasPointerDown"
  >
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
      <SnapGuides v-if="store.isResizing" :guides="store.guides" />
    </div>
    <CanvasFloatingToolbar />
  </div>
</template>
