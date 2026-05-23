// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from 'vitest';

import {
  TemplateSchema,
  ElementSchema,
  TextElementSchema,
  TableElementSchema,
  StyleSchema,
  BarcodeElementSchema,
  QrElementSchema,
  FieldElementSchema,
  FieldDefSchema,
  PaperSchema,
  CanvasSchema,
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
    paper: 'A4',
    orientation: 'landscape',
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
      type: 'qr',
      grid: { c: 0, r: 0, cs: 8, rs: 8 },
      anchor: { x: 0, y: 0, w: 8, h: 8 },
      style: baseStyle,
      content: { static: 'https://example.com' },
    });
    if (el.type === 'qr') {
      expect(el.type).toBe('qr');
    } else {
      throw new Error('expected qr');
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
});

describe('PaperSchema (iteration 4 + 9)', () => {
  it.each(['A3', 'A4', 'A5', 'B4', 'B5'])('accepts preset "%s"', (preset) => {
    expect(PaperSchema.parse(preset)).toBe(preset);
  });

  it('rejects removed presets', () => {
    expect(() => PaperSchema.parse('A4-Landscape')).toThrow();
    expect(() => PaperSchema.parse('GuardPass')).toThrow();
    expect(() => PaperSchema.parse('LogisticLabel')).toThrow();
    expect(() => PaperSchema.parse('A6')).toThrow();
    expect(() => PaperSchema.parse('Letter')).toThrow();
  });

  it('accepts custom { w_mm, h_mm }', () => {
    expect(PaperSchema.parse({ w_mm: 173, h_mm: 240 })).toMatchObject({ w_mm: 173 });
  });
});

describe('CanvasSchema orientation field', () => {
  it('defaults orientation to portrait', () => {
    const c = CanvasSchema.parse({
      cols: 240,
      rows: 160,
      cell: { w: 4, h: 4 },
      paper: 'A4',
      background: null,
    });
    expect(c.orientation).toBe('portrait');
  });

  it('accepts landscape', () => {
    const c = CanvasSchema.parse({
      cols: 240,
      rows: 160,
      cell: { w: 4, h: 4 },
      paper: 'A4',
      orientation: 'landscape',
      background: null,
    });
    expect(c.orientation).toBe('landscape');
  });
});

describe('QrElementSchema (iteration 5)', () => {
  const baseQr = {
    id: 'q1',
    type: 'qr' as const,
    grid: { c: 0, r: 0, cs: 12, rs: 12 },
    anchor: { x: 0, y: 0, w: 12, h: 12 },
    style: baseStyle,
    content: { static: 'SAMPLE' },
  };

  it('parses a QR element', () => {
    expect(ElementSchema.parse(baseQr).type).toBe('qr');
  });

  it('QR accepts eccLevel + colors + quietZone', () => {
    const el = {
      ...baseQr,
      eccLevel: 'H' as const,
      foregroundColor: '#111',
      backgroundColor: '#fff',
      quietZone: 3,
    };
    expect(QrElementSchema.parse(el).eccLevel).toBe('H');
  });

  it('QR accepts empty binding', () => {
    const el = { ...baseQr, binding: '', content: undefined };
    expect(QrElementSchema.parse(el).binding).toBe('');
  });
});

describe('BarcodeElementSchema (iteration 5 — 1D only)', () => {
  const base1d = {
    id: 'b1',
    type: 'barcode' as const,
    grid: { c: 0, r: 0, cs: 30, rs: 8 },
    anchor: { x: 0, y: 0, w: 60, h: 16 },
    style: baseStyle,
    content: { static: 'SAMPLE' },
  };

  it('rejects qr as a symbology', () => {
    expect(() => BarcodeElementSchema.parse({ ...base1d, symbology: 'qr' })).toThrow();
  });

  it('rejects ean8 / upc-a', () => {
    expect(() => BarcodeElementSchema.parse({ ...base1d, symbology: 'ean8' })).toThrow();
    expect(() => BarcodeElementSchema.parse({ ...base1d, symbology: 'upc-a' })).toThrow();
  });

  it('accepts Code 128 / Code 39 / EAN-13 / ITF-14', () => {
    for (const sym of ['code128', 'code39', 'ean13', 'itf14'] as const) {
      expect(BarcodeElementSchema.parse({ ...base1d, symbology: sym }).symbology).toBe(sym);
    }
  });

  it('accepts empty binding', () => {
    const el = { ...base1d, binding: '', content: undefined };
    expect(BarcodeElementSchema.parse(el).binding).toBe('');
  });
});

describe('FieldElementSchema (iteration 5)', () => {
  it('accepts empty binding (unbound)', () => {
    const el = {
      id: 'f1',
      type: 'field' as const,
      grid: { c: 0, r: 0, cs: 16, rs: 3 },
      anchor: { x: 0, y: 0, w: 50, h: 8 },
      style: baseStyle,
      binding: '',
      fallback: '—',
      format: null,
    };
    expect(FieldElementSchema.parse(el).binding).toBe('');
  });
});

describe('TemplateElementSchema element type coverage (iter 11)', () => {
  it('all schema-declared element types match renderer maps', () => {
    // Source of truth: which types the schema declares (discriminated union members)
    const schemaTypes = (ElementSchema.options as Array<{ shape: { type: { value: string } } }>)
      .map((opt) => opt.shape.type.value)
      .sort();

    // Mirror: which types the renderers handle.
    // Keep this list in sync with:
    //   - apps/web/src/designer/CanvasElement.vue (elementMap)
    //   - packages/template-renderer/src/TemplateRenderer.vue (elementMap)
    const renderedTypes = [
      'text',
      'field',
      'image',
      'table',
      'barcode',
      'qr',
      'autonumber',
      'system',
      'rect',
    ].sort();

    expect(schemaTypes).toEqual(renderedTypes);
  });
});
