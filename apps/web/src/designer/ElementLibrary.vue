<script setup lang="ts">
import { useDesignerStore } from '../stores/designer';
import { LIBRARY_ITEMS, buildElement, type ElementMeta } from './elementFactory';

const store = useDesignerStore();
const items = LIBRARY_ITEMS;

function clickAdd(meta: ElementMeta): void {
  const el = buildElement(meta, store.newElementId());
  store.addElement(el);
}

function onDragStart(e: DragEvent, meta: ElementMeta): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/x-tp-element', JSON.stringify(meta));
  e.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div class="tp-section-top">
    <div class="tp-sub-head">
      <span class="tp-sub-title">添加新元素</span>
      <span class="tp-sub-hint">点击或拖入</span>
    </div>
    <div class="lib-grid">
      <button
        v-for="item in items"
        :key="item.label"
        class="lib-btn"
        draggable="true"
        :title="`点击或拖入：${item.label}`"
        @click="clickAdd(item)"
        @dragstart="onDragStart($event, item)"
      >
        <span class="lib-glyph">{{ item.glyph }}</span>
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.lib-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 8px 10px 12px;
}
.lib-btn {
  padding: 10px 4px;
  background: var(--tp-panel);
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-item);
  cursor: grab;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--tp-ink-soft);
  font-size: 11px;
  transition: all 120ms ease;
  user-select: none;
}
.lib-btn:hover {
  border-color: var(--tp-accent);
  color: var(--tp-accent);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(108, 92, 231, 0.12);
}
.lib-btn:active {
  cursor: grabbing;
  transform: none;
}
.lib-glyph {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  font-size: 14px;
}
</style>
