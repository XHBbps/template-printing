<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  defaultGrid: { cs: number; rs: number };
  variant?: 'qr' | 'barcode'; // for differentiating qr vs other barcodes
}

const groups: { title: string; items: ElementMeta[] }[] = [
  {
    title: '基础',
    items: [
      { type: 'text', glyph: 'T', label: '文字', defaultGrid: { cs: 12, rs: 3 } },
      { type: 'field', glyph: '{}', label: '字段', defaultGrid: { cs: 16, rs: 3 } },
      { type: 'image', glyph: '▤', label: '图片', defaultGrid: { cs: 16, rs: 16 } },
      { type: 'rect', glyph: '▢', label: '矩形', defaultGrid: { cs: 16, rs: 8 } },
    ],
  },
  {
    title: '表格',
    items: [{ type: 'table', glyph: '▦', label: '明细表', defaultGrid: { cs: 60, rs: 24 } }],
  },
  {
    title: '编码',
    items: [
      {
        type: 'barcode',
        glyph: '▣',
        label: '二维码',
        defaultGrid: { cs: 12, rs: 12 },
        variant: 'qr',
      },
      {
        type: 'barcode',
        glyph: '|||',
        label: '条码',
        defaultGrid: { cs: 30, rs: 8 },
        variant: 'barcode',
      },
      { type: 'autonumber', glyph: '№', label: '编号', defaultGrid: { cs: 18, rs: 3 } },
    ],
  },
  {
    title: '系统',
    items: [{ type: 'system', glyph: '#', label: '页码/日期', defaultGrid: { cs: 12, rs: 3 } }],
  },
];

function defaultBorder() {
  const side = { show: false, width: 1, style: 'solid' as const, color: '#1f2328' };
  return { top: { ...side }, right: { ...side }, bottom: { ...side }, left: { ...side } };
}

function defaultStyle() {
  return {
    border: defaultBorder(),
    padding: { t: 0, r: 4, b: 2, l: 4 },
    background: null,
    borderRadius: 0,
  };
}

function buildElement(meta: ElementMeta): TemplateElement {
  const id = store.newElementId();
  const grid = { c: 4, r: 4, cs: meta.defaultGrid.cs, rs: meta.defaultGrid.rs };
  const style = defaultStyle();

  switch (meta.type) {
    case 'text':
      return { id, type: 'text', grid, style, content: { static: '示例文本' } };
    case 'field':
      return { id, type: 'field', grid, style, binding: 'fieldKey', fallback: '—', format: null };
    case 'image':
      return {
        id,
        type: 'image',
        grid,
        style,
        source: { kind: 'static', url: '' },
        fit: 'contain',
      };
    case 'rect':
      return { id, type: 'rect', grid, style };
    case 'table':
      return {
        id,
        type: 'table',
        grid,
        style,
        binding: 'items',
        columns: [
          { key: 'col1', header: '列1', cs: 30, align: 'left', format: null },
          { key: 'col2', header: '列2', cs: 30, align: 'right', format: null },
        ],
        rowHeight: 4,
        showHeader: true,
      };
    case 'barcode':
      return {
        id,
        type: 'barcode',
        grid,
        style,
        symbology: meta.variant === 'qr' ? 'qr' : 'code128',
        content: { static: 'SAMPLE' },
        showText: false,
      };
    case 'autonumber':
      return {
        id,
        type: 'autonumber',
        grid,
        style,
        sequence: 'default',
        format: '0000000',
        prefix: '',
      };
    case 'system':
      return { id, type: 'system', grid, style, variable: 'pageNo' };
  }
}

function addElement(meta: ElementMeta): void {
  store.addElement(buildElement(meta));
}
</script>

<template>
  <aside class="designer-left">
    <div v-for="group in groups" :key="group.title" class="group">
      <div class="group-title">{{ group.title }}</div>
      <button
        v-for="item in group.items"
        :key="item.label"
        class="elem-btn"
        :title="`点击添加 ${item.label}`"
        @click="addElement(item)"
      >
        <span class="glyph">{{ item.glyph }}</span>
        <span class="label">{{ item.label }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.group {
  padding: 8px;
}
.group-title {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--el-text-color-placeholder);
  margin: 4px 4px 6px;
}
.elem-btn {
  width: 100%;
  padding: 6px 4px;
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: #fff;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  color: var(--el-text-color-regular);
  transition: all 120ms ease;
}
.elem-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  transform: translateY(-1px);
}
.glyph {
  font-size: 14px;
}
</style>
