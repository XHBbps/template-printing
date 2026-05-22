// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// --- Border / padding shared by all elements ---

export const BorderSideSchema = z.object({
  show: z.boolean().default(false),
  width: z.number().nonnegative().default(1),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  color: z.string().default('#1f2328'),
});
export type BorderSide = z.infer<typeof BorderSideSchema>;

export const BorderSchema = z.object({
  top: BorderSideSchema,
  right: BorderSideSchema,
  bottom: BorderSideSchema,
  left: BorderSideSchema,
});

export const PaddingSchema = z.object({
  t: z.number().nonnegative().default(0),
  r: z.number().nonnegative().default(0),
  b: z.number().nonnegative().default(0),
  l: z.number().nonnegative().default(0),
});

export const StyleSchema = z.object({
  border: BorderSchema,
  padding: PaddingSchema,
  background: z.string().nullable().default(null),
  borderRadius: z.number().nonnegative().default(0),

  // Text-style fields (iteration 2). All optional; renderers treat undefined
  // as "inherit / use default".
  color: z.string().optional(),
  fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().positive().optional(),
  textDecoration: z.enum(['none', 'underline', 'overline', 'line-through']).optional(),
  backgroundColor: z.string().optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify', 'default']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  zIndex: z.number().int().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  textOverflow: z.enum(['clip', 'ellipsis', 'wrap']).optional(),

  // Legacy field kept for backward compat — superseded by `textAlign`.
  align: z.enum(['left', 'center', 'right']).optional(),
});
export type ElementStyle = z.infer<typeof StyleSchema>;

// --- Grid coordinates ---

export const GridPosSchema = z.object({
  c: z.number().int().nonnegative(),
  r: z.number().int().nonnegative(),
  cs: z.number().int().positive(),
  rs: z.number().int().positive(),
});
export type GridPos = z.infer<typeof GridPosSchema>;

// --- Anchor coordinates ---

export const AnchorSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

// --- Element variants (8 types) ---

const Base = z.object({
  id: z.string().min(1),
  grid: GridPosSchema,
  anchor: AnchorSchema,
  style: StyleSchema,
});

export const TextElementSchema = Base.extend({
  type: z.literal('text'),
  content: z.object({ static: z.string() }),
});

export const FieldElementSchema = Base.extend({
  type: z.literal('field'),
  binding: z.string().min(1),
  fallback: z.string().default('—'),
  format: z.string().nullable().default(null),
});

export const ImageElementSchema = Base.extend({
  type: z.literal('image'),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('static'), url: z.string() }),
    z.object({ kind: z.literal('field'), binding: z.string().min(1) }),
  ]),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
});

export const TableColumnSchema = z.object({
  key: z.string().min(1),
  header: z.string(),
  cs: z.number().int().positive(),
  align: z.enum(['left', 'center', 'right']).default('left'),
  format: z.string().nullable().default(null),
});

export const TableElementSchema = Base.extend({
  type: z.literal('table'),
  binding: z.string().min(1),
  columns: z.array(TableColumnSchema).min(1),
  rowHeight: z.number().int().positive(),
  showHeader: z.boolean().default(true),
  headerStyle: StyleSchema.partial().optional(),
  rowStyle: StyleSchema.partial().optional(),
});

export const BarcodeElementSchema = Base.extend({
  type: z.literal('barcode'),
  binding: z.string().min(1).optional(),
  content: z.object({ static: z.string() }).optional(),
  symbology: z.enum(['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc-a', 'itf14']).default('qr'),
  showText: z.boolean().default(false),

  // QR-only controls
  eccLevel: z.enum(['L', 'M', 'Q', 'H']).optional(),

  // Shared controls
  foregroundColor: z.string().default('#000000'),
  backgroundColor: z.string().default('#ffffff'),
  quietZone: z.number().nonnegative().default(2),

  // 1D-only controls
  textPosition: z.enum(['top', 'bottom']).optional(),
  textFontSize: z.number().positive().optional(),
});

export const AutonumberElementSchema = Base.extend({
  type: z.literal('autonumber'),
  sequence: z.string().min(1),
  format: z.string().default('0000000'),
  prefix: z.string().default(''),
});

export const SystemElementSchema = Base.extend({
  type: z.literal('system'),
  variable: z.enum(['pageNo', 'totalPages', 'now', 'printedBy']),
  format: z.string().optional(),
});

export const RectElementSchema = Base.extend({
  type: z.literal('rect'),
});

export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  FieldElementSchema,
  ImageElementSchema,
  TableElementSchema,
  BarcodeElementSchema,
  AutonumberElementSchema,
  SystemElementSchema,
  RectElementSchema,
]);
export type TemplateElement = z.infer<typeof ElementSchema>;

// --- Canvas + Schema (data contract) + Meta ---

export const CellSchema = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
});

export const PaperPresetSchema = z.enum(['A3', 'A4', 'A5', 'A6', 'B5', 'Letter']);
export type PaperPreset = z.infer<typeof PaperPresetSchema>;

export const PaperSchema = z.union([
  PaperPresetSchema,
  z.object({ w_mm: z.number().positive(), h_mm: z.number().positive() }),
]);

export const CanvasSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  cell: CellSchema,
  paper: PaperSchema,
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  background: z.string().nullable().default(null),
});

const FieldBase = z.object({
  label: z.string().min(1),
  required: z.boolean().default(false),
  example: z.string().optional(),
});

export const FieldDefSchema = z.discriminatedUnion('type', [
  FieldBase.extend({
    type: z.literal('string'),
    maxLength: z.number().int().positive().optional(),
  }),
  FieldBase.extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    thousands: z.boolean().default(false),
  }),
  FieldBase.extend({
    type: z.literal('date'),
    format: z.string().default('YYYY-MM-DD'),
  }),
  FieldBase.extend({
    type: z.literal('datetime'),
    format: z.string().default('YYYY-MM-DD HH:mm'),
  }),
  FieldBase.extend({
    type: z.literal('boolean'),
    trueLabel: z.string().default('是'),
    falseLabel: z.string().default('否'),
  }),
  FieldBase.extend({
    type: z.literal('enum'),
    options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
  }),
  FieldBase.extend({
    type: z.literal('image'),
    accept: z.array(z.string().min(1)).default(['image/svg+xml', 'image/png', 'image/jpeg']),
  }),
  FieldBase.extend({
    type: z.literal('array'),
    itemSchema: z.record(z.unknown()).optional(),
  }),
]);

export const TemplateMetaSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  version: z.number().int().positive().default(1),
  tags: z.array(z.string()).default([]),
});

export const TemplateSchema = z.object({
  id: z.string().min(1),
  meta: TemplateMetaSchema,
  canvas: CanvasSchema,
  schema: z.record(FieldDefSchema).default({}),
  elements: z.array(ElementSchema).default([]),
});
export type Template = z.infer<typeof TemplateSchema>;
