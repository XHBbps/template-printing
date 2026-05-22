<script setup lang="ts">
import { computed } from 'vue';
import { useDesignerStore } from '../stores/designer';
import { LIBRARY_ITEMS, buildElement, type ElementMeta, type LibraryGroup } from './elementFactory';

const store = useDesignerStore();
const groupOrder: LibraryGroup[] = ['文字', '图形', '数据'];
const itemsByGroup = computed<Record<LibraryGroup, ElementMeta[]>>(() => {
  return {
    文字: LIBRARY_ITEMS.filter((i) => i.group === '文字'),
    图形: LIBRARY_ITEMS.filter((i) => i.group === '图形'),
    数据: LIBRARY_ITEMS.filter((i) => i.group === '数据'),
  };
});

function clickAdd(meta: ElementMeta): void {
  const cell = store.template.canvas.cell;
  // Drop at a small default offset from top-left so successive clicks don't fully overlap.
  const count = store.template.elements.length;
  const anchorMm = { x: 4 + (count % 10) * 2, y: 4 + (count % 10) * 2 };
  const el = buildElement(meta, store.newElementId(), anchorMm, cell);
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
    </div>
    <div class="lib-scroll">
      <div v-for="g in groupOrder" :key="g" class="lib-group">
        <div class="lib-group-title">{{ g }}</div>
        <div class="lib-grid">
          <button
            v-for="item in itemsByGroup[g]"
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
    </div>
  </div>
</template>

<style scoped>
.lib-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}
.lib-group + .lib-group {
  margin-top: 8px;
}
.lib-group-title {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tp-ink-faint);
}
.lib-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 0 10px;
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
