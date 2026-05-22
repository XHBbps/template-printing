// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

const PX_PER_MM = 4;

export type LibraryGroup = '文字' | '图形' | '数据';

export interface ElementMeta {
  type: TemplateElement['type'];
  glyph: string;
  label: string;
  group: LibraryGroup;
  defaultMm: { w: number; h: number };
  variant?: 'qr' | 'barcode';
}

export const LIBRARY_ITEMS: ElementMeta[] = [
  { type: 'text', group: '文字', glyph: 'T', label: '文字', defaultMm: { w: 40, h: 8 } },
  { type: 'field', group: '文字', glyph: '{}', label: '字段', defaultMm: { w: 50, h: 8 } },
  { type: 'autonumber', group: '文字', glyph: '№', label: '编号', defaultMm: { w: 45, h: 8 } },
  { type: 'system', group: '文字', glyph: '#', label: '系统', defaultMm: { w: 45, h: 8 } },
  { type: 'rect', group: '图形', glyph: '▢', label: '矩形', defaultMm: { w: 40, h: 20 } },
  { type: 'image', group: '图形', glyph: '▤', label: '图片', defaultMm: { w: 40, h: 40 } },
  { type: 'table', group: '数据', glyph: '▦', label: '明细', defaultMm: { w: 150, h: 60 } },
  {
    type: 'barcode',
    group: '数据',
    glyph: '▣',
    label: '二维码',
    defaultMm: { w: 25, h: 25 },
    variant: 'qr',
  },
  {
    type: 'barcode',
    group: '数据',
    glyph: '|||',
    label: '条码',
    defaultMm: { w: 60, h: 16 },
    variant: 'barcode',
  },
];

export const MIN_MM: Record<string, { w: number; h: number }> = {
  text: { w: 8, h: 4 },
  field: { w: 12, h: 4 },
  autonumber: { w: 12, h: 4 },
  system: { w: 12, h: 4 },
  rect: { w: 4, h: 4 },
  image: { w: 10, h: 10 },
  table: { w: 60, h: 20 },
  qr: { w: 12, h: 12 },
  barcode1d: { w: 25, h: 8 },
};

export function minMmFor(el: TemplateElement): { w: number; h: number } {
  if (el.type === 'barcode') return el.symbology === 'qr' ? MIN_MM.qr : MIN_MM.barcode1d;
  return MIN_MM[el.type];
}

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
  anchorMm: { x: number; y: number },
  cell: { w: number; h: number },
): TemplateElement {
  const anchor = {
    x: anchorMm.x,
    y: anchorMm.y,
    w: meta.defaultMm.w,
    h: meta.defaultMm.h,
  };
  const grid = {
    c: Math.round((anchor.x * PX_PER_MM) / cell.w),
    r: Math.round((anchor.y * PX_PER_MM) / cell.h),
    cs: Math.max(1, Math.round((anchor.w * PX_PER_MM) / cell.w)),
    rs: Math.max(1, Math.round((anchor.h * PX_PER_MM) / cell.h)),
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
