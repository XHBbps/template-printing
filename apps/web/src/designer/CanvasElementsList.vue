<script setup lang="ts">
import { computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

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

const elements = computed(() => store.template.elements);

function selectOne(id: string): void {
  store.select([id]);
}
</script>

<template>
  <div class="canvas-elems-list">
    <div class="tp-sub-head">
      <span class="tp-sub-title">画布元素 · {{ elements.length }}</span>
    </div>
    <div class="list-body">
      <div v-if="elements.length === 0" class="empty">从上方拖入或点击元素来开始设计</div>
      <button
        v-for="el in elements"
        :key="el.id"
        class="elem-row"
        :class="{ 'is-active': store.selectedIds.includes(el.id) }"
        @click="selectOne(el.id)"
      >
        <span class="elem-icon">{{ iconGlyph(el.type) }}</span>
        <span class="elem-label">{{ summarize(el) }}</span>
      </button>
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
  padding: 6px 8px 14px;
}
.empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--tp-ink-faint);
  font-size: 12px;
  line-height: 1.6;
}
.elem-row {
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
  border: none;
  text-align: left;
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
</style>
