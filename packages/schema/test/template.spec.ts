// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from 'vitest';

import {
  TemplateSchema,
  ElementSchema,
  TextElementSchema,
  TableElementSchema,
  StyleSchema,
  BarcodeElementSchema,
  FieldDefSchema,
  type Template,
  // eslint-disable-next-line import/no-unresolved
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

describe('expanded StyleSchema', () => {
  it('accepts new optional style fields', () => {
    const style = {
      ...baseStyle,
      color: '#222',
      fontFamily: 'serif' as const,
      fontSize: 14,
      fontWeight: 600 as const,
      letterSpacing: 0.5,
      lineHeight: 1.5,
      textDecoration: 'underline' as const,
      backgroundColor: '#fff',
      textAlign: 'center' as const,
      verticalAlign: 'middle' as const,
      zIndex: 5,
      rotation: 30,
      opacity: 0.8,
      textOverflow: 'ellipsis' as const,
    };
    expect(StyleSchema.parse(style)).toMatchObject({
      color: '#222',
      fontWeight: 600,
      rotation: 30,
      opacity: 0.8,
    });
  });

  it('rejects opacity > 1', () => {
    expect(() => StyleSchema.parse({ ...baseStyle, opacity: 1.5 })).toThrow();
  });

  it('rejects fontWeight outside the enum', () => {
    expect(() => StyleSchema.parse({ ...baseStyle, fontWeight: 800 })).toThrow();
  });
});

describe('FieldDefSchema discriminated union', () => {
  it('parses a string field with maxLength', () => {
    const f = { type: 'string', label: 'Name', required: true, maxLength: 50 };
    expect(FieldDefSchema.parse(f).type).toBe('string');
  });

  it('parses a number field with thousands flag', () => {
    const f = { type: 'number', label: 'Amount', thousands: true };
    expect(FieldDefSchema.parse(f).type).toBe('number');
  });

  it('parses a datetime field', () => {
    const f = { type: 'datetime', label: 'Created', format: 'YYYY-MM-DD HH:mm' };
    expect(FieldDefSchema.parse(f).type).toBe('datetime');
  });

  it('parses a boolean field with custom labels', () => {
    const f = { type: 'boolean', label: 'Active', trueLabel: 'Yes', falseLabel: 'No' };
    expect(FieldDefSchema.parse(f).trueLabel).toBe('Yes');
  });

  it('parses an enum field with options', () => {
    const f = {
      type: 'enum',
      label: 'Status',
      options: [
        { value: 'a', label: '已通过' },
        { value: 'b', label: '已拒绝' },
      ],
    };
    expect(FieldDefSchema.parse(f).options).toHaveLength(2);
  });

  it('parses an image field with accept', () => {
    const f = { type: 'image', label: 'Logo', accept: ['image/svg+xml', 'image/png'] };
    expect(FieldDefSchema.parse(f).accept).toContain('image/svg+xml');
  });

  it('rejects an enum field with no options', () => {
    const f = { type: 'enum', label: 'X', options: [] };
    expect(() => FieldDefSchema.parse(f)).toThrow();
  });

  it('keeps the array field shape', () => {
    const f = { type: 'array', label: 'Items' };
    expect(FieldDefSchema.parse(f).type).toBe('array');
  });
});

describe('expanded BarcodeElementSchema', () => {
  const baseBarcode = {
    id: 'b1',
    type: 'barcode' as const,
    grid: { c: 0, r: 0, cs: 12, rs: 12 },
    anchor: { x: 0, y: 0, w: 12, h: 12 },
    style: baseStyle,
    content: { static: 'SAMPLE' },
    showText: false,
  };

  it('accepts qr with eccLevel + colors + quietZone', () => {
    const el = {
      ...baseBarcode,
      symbology: 'qr' as const,
      eccLevel: 'Q' as const,
      foregroundColor: '#111',
      backgroundColor: '#fff',
      quietZone: 4,
    };
    expect(BarcodeElementSchema.parse(el).eccLevel).toBe('Q');
  });

  it('accepts code128 with textPosition + textFontSize', () => {
    const el = {
      ...baseBarcode,
      symbology: 'code128' as const,
      showText: true,
      textPosition: 'top' as const,
      textFontSize: 12,
    };
    expect(BarcodeElementSchema.parse(el).textPosition).toBe('top');
  });

  it('accepts new symbology values ean8, upc-a, itf14', () => {
    for (const sym of ['ean8', 'upc-a', 'itf14'] as const) {
      const el = { ...baseBarcode, symbology: sym };
      expect(BarcodeElementSchema.parse(el).symbology).toBe(sym);
    }
  });
});
