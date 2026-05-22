// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const PX_PER_MM = 4;

export type LibraryGroup = '文字' | '图形' | '数据';

export interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  group: LibraryGroup;
  defaultGrid: { cs: number; rs: number };
  variant?: 'qr' | 'barcode';
}

export const LIBRARY_ITEMS: ElementMeta[] = [
  { type: 'text', group: '文字', glyph: 'T', label: '文字', defaultGrid: { cs: 12, rs: 3 } },
  { type: 'field', group: '文字', glyph: '{}', label: '字段', defaultGrid: { cs: 16, rs: 3 } },
  { type: 'autonumber', group: '文字', glyph: '№', label: '编号', defaultGrid: { cs: 18, rs: 3 } },
  { type: 'system', group: '文字', glyph: '#', label: '系统', defaultGrid: { cs: 18, rs: 3 } },
  { type: 'rect', group: '图形', glyph: '▢', label: '矩形', defaultGrid: { cs: 16, rs: 8 } },
  { type: 'image', group: '图形', glyph: '▤', label: '图片', defaultGrid: { cs: 16, rs: 16 } },
  { type: 'table', group: '数据', glyph: '▦', label: '明细', defaultGrid: { cs: 60, rs: 24 } },
  {
    type: 'barcode',
    group: '数据',
    glyph: '▣',
    label: '二维码',
    defaultGrid: { cs: 12, rs: 12 },
    variant: 'qr',
  },
  {
    type: 'barcode',
    group: '数据',
    glyph: '|||',
    label: '条码',
    defaultGrid: { cs: 30, rs: 8 },
    variant: 'barcode',
  },
];

function defaultBorder() {
  const side = { show: false, width: 1, style: 'solid' as const, color: '#1f1f23' };
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

export function buildElement(
  meta: ElementMeta,
  newId: string,
  c = 4,
  r = 4,
  cellW = 4,
  cellH = 4,
): TemplateElement {
  const grid = { c, r, cs: meta.defaultGrid.cs, rs: meta.defaultGrid.rs };
  const anchor = {
    x: (c * cellW) / PX_PER_MM,
    y: (r * cellH) / PX_PER_MM,
    w: (grid.cs * cellW) / PX_PER_MM,
    h: (grid.rs * cellH) / PX_PER_MM,
  };
  const style = defaultStyle();
  switch (meta.type) {
    case 'text':
      return { id: newId, type: 'text', grid, anchor, style, content: { static: '示例文本' } };
    case 'field':
      return {
        id: newId,
        type: 'field',
        grid,
        anchor,
        style,
        binding: 'fieldKey',
        fallback: '—',
        format: null,
      };
    case 'image':
      return {
        id: newId,
        type: 'image',
        grid,
        anchor,
        style,
        source: { kind: 'static', url: '' },
        fit: 'contain',
      };
    case 'rect':
      return { id: newId, type: 'rect', grid, anchor, style };
    case 'table':
      return {
        id: newId,
        type: 'table',
        grid,
        anchor,
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
        id: newId,
        type: 'barcode',
        grid,
        anchor,
        style,
        symbology: meta.variant === 'qr' ? 'qr' : 'code128',
        content: { static: 'SAMPLE' },
        showText: false,
        foregroundColor: '#000000',
        backgroundColor: '#ffffff',
        quietZone: 2,
        ...(meta.variant === 'qr'
          ? { eccLevel: 'M' as const }
          : { textPosition: 'bottom' as const, textFontSize: 10 }),
      };
    case 'autonumber':
      return {
        id: newId,
        type: 'autonumber',
        grid,
        anchor,
        style,
        sequence: 'default',
        format: '0000000',
        prefix: '',
      };
    case 'system':
      return { id: newId, type: 'system', grid, anchor, style, variable: 'pageNo' };
  }
}
