<script setup lang="ts">
import { computed, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const PAGE_SIZE = 10;
const page = ref(1);

const elements = computed(() => store.template.elements);
const pageCount = computed(() => Math.max(1, Math.ceil(elements.value.length / PAGE_SIZE)));
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return elements.value.slice(start, start + PAGE_SIZE);
});

watch(pageCount, (n) => {
  if (page.value > n) page.value = n;
});

// When user selects an element via PropertyPanel or canvas, flip to the page containing it.
watch(
  () => store.selectedIds,
  (ids) => {
    if (ids.length !== 1) return;
    const idx = elements.value.findIndex((el) => el.id === ids[0]);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (targetPage !== page.value) page.value = targetPage;
  },
);

function summarize(el: TemplateElement): string {
  switch (el.type) {
    case 'text':
      return `text · ${el.content.static.slice(0, 16) || '空'}`;
    case 'field':
      return `field · ${el.binding}`;
    case 'image':
      return `image`;
    case 'rect':
      return `rect`;
    case 'table':
      return `table · ${el.binding}`;
    case 'barcode':
      return `${el.symbology === 'qr' ? 'qr' : 'barcode'} · ${el.content?.static ?? el.binding ?? '空'}`;
    case 'autonumber':
      return `№ · ${el.sequence}`;
    case 'system':
      return `system · ${el.variable}`;
  }
}
function iconGlyph(type: TemplateElement['type']): string {
  switch (type) {
    case 'text':
      return 'T';
    case 'field':
      return '{}';
    case 'image':
      return '▤';
    case 'rect':
      return '▢';
    case 'table':
      return '▦';
    case 'barcode':
      return '▣';
    case 'autonumber':
      return '№';
    case 'system':
      return '#';
  }
}
function selectOne(id: string): void {
  store.select([id]);
}
function removeEl(id: string, e: Event): void {
  e.stopPropagation();
  store.deleteElement(id);
}
</script>

<template>
  <div class="canvas-elems-list">
    <div class="tp-sub-head">
      <span class="tp-sub-title">画布元素 · 共 {{ elements.length }} 个</span>
    </div>
    <div class="list-body">
      <div v-if="elements.length === 0" class="empty">从上方拖入或点击元素来开始设计</div>
      <div
        v-for="el in paged"
        :key="el.id"
        class="elem-row"
        :class="{ 'is-active': store.selectedIds.includes(el.id) }"
        @click="selectOne(el.id)"
      >
        <span class="elem-icon">{{ iconGlyph(el.type) }}</span>
        <span class="elem-label">{{ summarize(el) }}</span>
        <button class="elem-del" @click="(e: Event) => removeEl(el.id, e)" title="删除">×</button>
      </div>
    </div>
    <div v-if="pageCount > 1" class="pagination">
      <button :disabled="page <= 1" @click="page--">‹</button>
      <span class="pgno">{{ page }} / {{ pageCount }}</span>
      <button :disabled="page >= pageCount" @click="page++">›</button>
      <span class="pgsize">每页 {{ PAGE_SIZE }}</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-elems-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px 6px;
}
.empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--tp-ink-faint);
  font-size: 12px;
  line-height: 1.6;
}
.elem-row {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--tp-radius-item);
  cursor: pointer;
  color: var(--tp-ink);
  font-size: 12.5px;
  margin-bottom: 2px;
  background: transparent;
}
.elem-row:hover {
  background: var(--tp-field-bg);
}
.elem-row.is-active {
  background: var(--tp-accent-bg);
  color: var(--tp-accent-ink);
  font-weight: 600;
}
.elem-row.is-active .elem-icon {
  background: var(--tp-accent);
  color: #fff;
}
.elem-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--tp-field-bg);
  color: var(--tp-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, monospace;
  font-weight: 600;
  font-size: 11px;
}
.elem-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.elem-del {
  border: none;
  background: transparent;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--tp-ink-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease;
}
.elem-row:hover .elem-del {
  opacity: 1;
}
.elem-del:hover {
  background: rgba(217, 79, 79, 0.1);
  color: #d94f4f;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 10px 10px;
  border-top: 1px solid var(--tp-line);
  font-size: 11px;
  color: var(--tp-ink-soft);
}
.pagination button {
  width: 22px;
  height: 22px;
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  border-radius: 4px;
  cursor: pointer;
  color: var(--tp-ink);
}
.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination .pgno {
  font-family: ui-monospace, monospace;
}
.pagination .pgsize {
  margin-left: auto;
  color: var(--tp-ink-faint);
}
</style>
