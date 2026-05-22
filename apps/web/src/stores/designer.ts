// eslint-disable-next-line import/no-unresolved
import type { Template, TemplateElement, FieldDefSchema, Anchor } from '@template-printing/schema';
// eslint-disable-next-line import/no-unresolved
import { ElMessage } from 'element-plus';
import { defineStore } from 'pinia';
// eslint-disable-next-line import/no-unresolved
// eslint-disable-next-line import/no-unresolved
import type { z } from 'zod';

type FieldDef = z.infer<typeof FieldDefSchema>;

const STORAGE_KEY = 'tp_designer_draft';
const HISTORY_LIMIT = 50;

// Pixels-per-mm. With 4 px/mm and the paper sizes below, both canvas dimensions
// share a healthy common-divisor set so cell w/h have many valid options.
const PX_PER_MM = 4;

// Paper presets in mm. With PX_PER_MM = 4 the resulting pixel dimensions
// share a healthy common-divisor set for most pairs, so cell w/h has many
// valid options. Custom papers are allowed via { w_mm, h_mm }.
const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
  A3: { w_mm: 297, h_mm: 420 },
  'A3-Landscape': { w_mm: 420, h_mm: 297 },
  A4: { w_mm: 210, h_mm: 297 },
  'A4-Landscape': { w_mm: 297, h_mm: 210 },
  A5: { w_mm: 148, h_mm: 210 },
  'A5-Landscape': { w_mm: 210, h_mm: 148 },
  A6: { w_mm: 105, h_mm: 148 },
  B5: { w_mm: 176, h_mm: 250 },
  Letter: { w_mm: 216, h_mm: 279 },
  GuardPass: { w_mm: 90, h_mm: 60 },
  LogisticLabel: { w_mm: 100, h_mm: 180 },
};

function paperPxSize(paper: Template['canvas']['paper']): { w: number; h: number } {
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    const p = PAPER_PRESETS[paper];
    return { w: p.w_mm * PX_PER_MM, h: p.h_mm * PX_PER_MM };
  }
  if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
    return { w: paper.w_mm * PX_PER_MM, h: paper.h_mm * PX_PER_MM };
  }
  const p = PAPER_PRESETS['A4-Landscape'];
  return { w: p.w_mm * PX_PER_MM, h: p.h_mm * PX_PER_MM };
}

function divisorsInRange(n: number, min = 2, max = 40): number[] {
  const out: number[] = [];
  for (let i = min; i <= max && i <= n; i++) {
    if (n % i === 0) out.push(i);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mmFromPx(px: number): number {
  return px / PX_PER_MM;
}

export function recomputeGridFromAnchor(el: TemplateElement, cell: { w: number; h: number }): void {
  el.grid = {
    c: Math.round((el.anchor.x * PX_PER_MM) / cell.w),
    r: Math.round((el.anchor.y * PX_PER_MM) / cell.h),
    cs: Math.max(1, Math.round((el.anchor.w * PX_PER_MM) / cell.w)),
    rs: Math.max(1, Math.round((el.anchor.h * PX_PER_MM) / cell.h)),
  };
}

export function clampAnchorToPaper(
  el: TemplateElement,
  paper: { w_mm: number; h_mm: number },
): boolean {
  let changed = false;
  if (el.anchor.w > paper.w_mm) {
    el.anchor.w = paper.w_mm;
    changed = true;
  }
  if (el.anchor.h > paper.h_mm) {
    el.anchor.h = paper.h_mm;
    changed = true;
  }
  if (el.anchor.x + el.anchor.w > paper.w_mm) {
    el.anchor.x = paper.w_mm - el.anchor.w;
    changed = true;
  }
  if (el.anchor.y + el.anchor.h > paper.h_mm) {
    el.anchor.y = paper.h_mm - el.anchor.h;
    changed = true;
  }
  if (el.anchor.x < 0) {
    el.anchor.x = 0;
    changed = true;
  }
  if (el.anchor.y < 0) {
    el.anchor.y = 0;
    changed = true;
  }
  return changed;
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultBorder() {
  const side = { show: false, width: 1, style: 'solid' as const, color: '#1f2328' };
  return { top: { ...side }, right: { ...side }, bottom: { ...side }, left: { ...side } };
}

// Used by element library when creating new elements
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function defaultStyle() {
  return {
    border: defaultBorder(),
    padding: { t: 0, r: 4, b: 2, l: 4 },
    background: null,
    borderRadius: 0,
  };
}

export function defaultTemplate(): Template {
  const paper = 'A4-Landscape';
  const px = paperPxSize(paper);
  const cellW = 4;
  const cellH = 4;
  return {
    id: makeId('tpl'),
    meta: { name: '未命名模板', description: '', version: 1, tags: [] },
    canvas: {
      cols: px.w / cellW,
      rows: px.h / cellH,
      cell: { w: cellW, h: cellH },
      paper,
      background: null,
    },
    schema: {},
    elements: [],
  };
}

export const useDesignerStore = defineStore('designer', {
  state: () => ({
    template: defaultTemplate(),
    selectedIds: [] as string[],
    history: [] as string[],
    historyIndex: -1,
    dirty: false,
    isResizing: false,
  }),
  getters: {
    canUndo: (s): boolean => s.historyIndex > 0,
    canRedo: (s): boolean => s.historyIndex < s.history.length - 1,
    selectedElement: (s): TemplateElement | null => {
      if (s.selectedIds.length !== 1) return null;
      return s.template.elements.find((e) => e.id === s.selectedIds[0]) ?? null;
    },
    fieldDefs: (s): Array<{ key: string; def: FieldDef }> =>
      Object.entries(s.template.schema).map(([key, def]) => ({ key, def })),
    usedFieldKeys: (s): Set<string> => {
      const used = new Set<string>();
      for (const el of s.template.elements) {
        if (el.type === 'field' || el.type === 'table') used.add(el.binding);
        if (el.type === 'image' && el.source.kind === 'field') used.add(el.source.binding);
        if (el.type === 'barcode' && el.binding) used.add(el.binding);
      }
      return used;
    },
    // Paper size in pixels — canvas always equals this regardless of cell size
    paperPx: (s): { w: number; h: number } => paperPxSize(s.template.canvas.paper),
  },
  actions: {
    snapshot(): void {
      const json = JSON.stringify(this.template);
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(json);
      if (this.history.length > HISTORY_LIMIT) {
        this.history.shift();
      } else {
        this.historyIndex++;
      }
      this.dirty = true;
      this.persist();
    },
    undo(): void {
      if (!this.canUndo) return;
      this.historyIndex--;
      this.template = JSON.parse(this.history[this.historyIndex]);
      this.persist();
    },
    redo(): void {
      if (!this.canRedo) return;
      this.historyIndex++;
      this.template = JSON.parse(this.history[this.historyIndex]);
      this.persist();
    },
    persist(): void {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.template));
      } catch {
        // Ignore quota / privacy-mode failures
      }
    },
    restore(): boolean {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as Template;

        // Step 1 — Migrate iteration-1 drafts: derive anchor from grid + OLD cell.
        const oldCell = parsed.canvas.cell;
        for (const el of parsed.elements as Array<TemplateElement & { anchor?: Anchor }>) {
          if (!el.anchor) {
            el.anchor = {
              x: (el.grid.c * oldCell.w) / PX_PER_MM,
              y: (el.grid.r * oldCell.h) / PX_PER_MM,
              w: (el.grid.cs * oldCell.w) / PX_PER_MM,
              h: (el.grid.rs * oldCell.h) / PX_PER_MM,
            };
          }
        }

        // Step 2 — Snap cell to a valid divisor of paper (iteration-1 logic).
        const px = paperPxSize(parsed.canvas.paper);
        let { w, h } = parsed.canvas.cell;
        if (px.w % w !== 0 || px.h % h !== 0) {
          const wOpts = divisorsInRange(px.w);
          const hOpts = divisorsInRange(px.h);
          w = wOpts.includes(4) ? 4 : wOpts[0] ?? 1;
          h = hOpts.includes(4) ? 4 : hOpts[0] ?? 1;
          parsed.canvas.cell = { w, h };
        }
        parsed.canvas.cols = px.w / w;
        parsed.canvas.rows = px.h / h;

        // Step 3 — Recompute grid for every element from anchor + new cell.
        for (const el of parsed.elements) {
          recomputeGridFromAnchor(el, parsed.canvas.cell);
        }

        this.template = parsed;
        this.history = [JSON.stringify(parsed)];
        this.historyIndex = 0;
        return true;
      } catch {
        return false;
      }
    },
    reset(): void {
      this.template = defaultTemplate();
      this.history = [JSON.stringify(this.template)];
      this.historyIndex = 0;
      this.selectedIds = [];
      this.dirty = false;
      this.persist();
    },
    select(ids: string[]): void {
      this.selectedIds = ids;
    },
    clearSelection(): void {
      this.selectedIds = [];
    },
    addElement(el: TemplateElement): void {
      this.template.elements.push(el);
      this.snapshot();
      this.select([el.id]);
    },
    updateElement(id: string, updates: Partial<TemplateElement>): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const merged = { ...this.template.elements[idx], ...updates } as TemplateElement;
      this.template.elements[idx] = merged;
      this.snapshot();
    },
    moveElement(id: string, c: number, r: number): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      this.template.elements[idx] = {
        ...this.template.elements[idx],
        grid: { ...this.template.elements[idx].grid, c, r },
      };
    },
    resizeElement(id: string, cs: number, rs: number, c?: number, r?: number): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = this.template.elements[idx];
      this.template.elements[idx] = {
        ...cur,
        grid: { c: c ?? cur.grid.c, r: r ?? cur.grid.r, cs, rs },
      };
    },
    commit(): void {
      this.snapshot();
    },
    deleteElement(id: string): void {
      this.template.elements = this.template.elements.filter((e) => e.id !== id);
      this.selectedIds = this.selectedIds.filter((s) => s !== id);
      this.snapshot();
    },
    // 关键约束：cell.w 必须整除 paperPxW，cell.h 必须整除 paperPxH。
    // 不满足的尺寸直接拒绝；cols/rows 由 paper 与 cell 派生。
    setCellSize(w: number, h: number): void {
      const px = paperPxSize(this.template.canvas.paper);
      if (px.w % w !== 0 || px.h % h !== 0) return;
      this.template.canvas.cell = { w, h };
      this.template.canvas.cols = px.w / w;
      this.template.canvas.rows = px.h / h;
      for (const el of this.template.elements) {
        recomputeGridFromAnchor(el, this.template.canvas.cell);
      }
      this.snapshot();
    },
    setCanvasSize(_cols: number, _rows: number): void {
      // Canvas size is locked to paper; ignore direct cols/rows mutation.
      // Kept for backward compat with older callers.
    },
    setPaper(paper: Template['canvas']['paper']): void {
      const px = paperPxSize(paper);
      let { w, h } = this.template.canvas.cell;
      if (px.w % w !== 0 || px.h % h !== 0) {
        const wOpts = divisorsInRange(px.w);
        const hOpts = divisorsInRange(px.h);
        w = wOpts.includes(4) ? 4 : wOpts[0] ?? 1;
        h = hOpts.includes(4) ? 4 : hOpts[0] ?? 1;
      }

      // Resolve new paper in mm so we can clamp anchors.
      let newMm: { w_mm: number; h_mm: number };
      if (typeof paper === 'string' && paper in PAPER_PRESETS) {
        newMm = PAPER_PRESETS[paper];
      } else if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
        newMm = { w_mm: paper.w_mm, h_mm: paper.h_mm };
      } else {
        newMm = PAPER_PRESETS['A4-Landscape'];
      }

      let movedCount = 0;
      for (const el of this.template.elements) {
        if (clampAnchorToPaper(el, newMm)) movedCount++;
      }

      this.template.canvas.paper = paper;
      this.template.canvas.cell = { w, h };
      this.template.canvas.cols = px.w / w;
      this.template.canvas.rows = px.h / h;
      for (const el of this.template.elements) {
        recomputeGridFromAnchor(el, this.template.canvas.cell);
      }
      this.snapshot();

      if (movedCount > 0) {
        ElMessage.warning(`${movedCount} 个元素已自动移入新画布`);
      }
    },
    setName(name: string): void {
      this.template.meta.name = name;
      this.snapshot();
    },
    addField(key: string, def: FieldDef): void {
      this.template.schema[key] = def;
      this.snapshot();
    },
    removeField(key: string): void {
      delete this.template.schema[key];
      this.snapshot();
    },
    newElementId(): string {
      return makeId('e');
    },
    // List of valid (cell.w, cell.h) preset pairs for the current paper.
    // Both axes share many divisors with our 4 px/mm paper sizes, so we
    // present the common ones as square presets plus a few common rectangles.
    validCellOptions(): Array<{ w: number; h: number; cols: number; rows: number }> {
      const px = paperPxSize(this.template.canvas.paper);
      const wOpts = divisorsInRange(px.w);
      const hOpts = divisorsInRange(px.h);
      const common = wOpts.filter((d) => hOpts.includes(d));
      const out: Array<{ w: number; h: number; cols: number; rows: number }> = [];
      for (const d of common) {
        out.push({ w: d, h: d, cols: px.w / d, rows: px.h / d });
      }
      return out;
    },
  },
});
