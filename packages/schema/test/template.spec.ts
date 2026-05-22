import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import {
  TemplateSchema,
  ElementSchema,
  TextElementSchema,
  TableElementSchema,
  type Template,
} from '../src/template.js';

const minimalTemplate: Template = {
  id: 'tpl_test',
  meta: { name: 'Test', description: '', version: 1, tags: [] },
  canvas: {
    cols: 240,
    rows: 160,
    cell: { w: 4, h: 4 },
    paper: 'A4-Landscape',
    background: null,
  },
  schema: {},
  elements: [],
};

const fullBorder = {
  top: { show: false, width: 1, style: 'solid' as const, color: '#1f2328' },
  right: { show: false, width: 1, style: 'solid' as const, color: '#1f2328' },
  bottom: { show: true, width: 1.5, style: 'solid' as const, color: '#1f2328' },
  left: { show: false, width: 1, style: 'solid' as const, color: '#1f2328' },
};

const baseStyle = {
  border: fullBorder,
  padding: { t: 0, r: 4, b: 2, l: 4 },
  background: null,
  borderRadius: 0,
};

describe('TemplateSchema', () => {
  it('accepts a minimal valid template', () => {
    const parsed = TemplateSchema.parse(minimalTemplate);
    expect(parsed.id).toBe('tpl_test');
  });

  it('rejects template without meta.name', () => {
    expect(() =>
      TemplateSchema.parse({ ...minimalTemplate, meta: { ...minimalTemplate.meta, name: '' } }),
    ).toThrow();
  });

  it('rejects negative canvas cols', () => {
    expect(() =>
      TemplateSchema.parse({
        ...minimalTemplate,
        canvas: { ...minimalTemplate.canvas, cols: -1 },
      }),
    ).toThrow();
  });
});

describe('ElementSchema', () => {
  it('accepts text element', () => {
    const el = TextElementSchema.parse({
      id: 'e1',
      type: 'text',
      grid: { c: 0, r: 0, cs: 10, rs: 2 },
      anchor: { x: 0, y: 0, w: 10, h: 2 },
      style: baseStyle,
      content: { static: 'Hello' },
    });
    expect(el.content.static).toBe('Hello');
  });

  it('table element requires at least one column', () => {
    expect(() =>
      TableElementSchema.parse({
        id: 'e2',
        type: 'table',
        grid: { c: 0, r: 0, cs: 20, rs: 10 },
        anchor: { x: 0, y: 0, w: 20, h: 10 },
        style: baseStyle,
        binding: 'items',
        columns: [],
        rowHeight: 4,
        showHeader: true,
      }),
    ).toThrow();
  });

  it('discriminated union narrows correctly', () => {
    const el = ElementSchema.parse({
      id: 'b1',
      type: 'barcode',
      grid: { c: 0, r: 0, cs: 8, rs: 8 },
      anchor: { x: 0, y: 0, w: 8, h: 8 },
      style: baseStyle,
      symbology: 'qr',
      content: { static: 'https://example.com' },
    });
    if (el.type === 'barcode') {
      expect(el.symbology).toBe('qr');
    } else {
      throw new Error('expected barcode');
    }
  });

  it('rejects unknown element type', () => {
    expect(() =>
      ElementSchema.parse({
        id: 'x',
        type: 'unknown',
        grid: { c: 0, r: 0, cs: 1, rs: 1 },
        anchor: { x: 0, y: 0, w: 1, h: 1 },
        style: baseStyle,
      }),
    ).toThrow();
  });

  describe('anchor field', () => {
    it('parses an element with an anchor', () => {
      const el = {
        id: 'e1',
        type: 'text',
        grid: { c: 0, r: 0, cs: 4, rs: 2 },
        anchor: { x: 0, y: 0, w: 4, h: 2 },
        style: baseStyle,
        content: { static: 'hi' },
      };
      expect(ElementSchema.parse(el)).toMatchObject({ anchor: { x: 0, y: 0, w: 4, h: 2 } });
    });

    it('rejects negative anchor coordinates', () => {
      const el = {
        id: 'e1',
        type: 'text',
        grid: { c: 0, r: 0, cs: 4, rs: 2 },
        anchor: { x: -1, y: 0, w: 4, h: 2 },
        style: baseStyle,
        content: { static: 'hi' },
      };
      expect(() => ElementSchema.parse(el)).toThrow();
    });

    it('rejects zero-size anchor', () => {
      const el = {
        id: 'e1',
        type: 'text',
        grid: { c: 0, r: 0, cs: 4, rs: 2 },
        anchor: { x: 0, y: 0, w: 0, h: 2 },
        style: baseStyle,
        content: { static: 'hi' },
      };
      expect(() => ElementSchema.parse(el)).toThrow();
    });
  });
});
