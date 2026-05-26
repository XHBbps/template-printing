// eslint-disable-next-line import/no-unresolved
import type { Template, TemplateElement, FieldDefSchema, Anchor } from '@template-printing/schema';

// eslint-disable-next-line import/no-unresolved
import { ElMessage } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { defineStore } from 'pinia';
// eslint-disable-next-line import/no-unresolved
import { nextTick } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { z } from 'zod';

import { minMmFor, allowedFieldTypesForElement } from '../designer/elementFactory';

type FieldDef = z.infer<typeof FieldDefSchema>;

const STORAGE_KEY = 'tp_designer_draft';
const HISTORY_LIMIT = 50;

// Pixels-per-mm. With 4 px/mm and the paper sizes below, both canvas dimensions
// share a healthy common-divisor set so cell w/h have many valid options.
const PX_PER_MM = 4;
const STEP_MM = 0.25;

function snapToStep(mm: number): number {
  return Math.round(mm / STEP_MM) * STEP_MM;
}

// Paper presets in mm. With PX_PER_MM = 4 the resulting pixel dimensions
// share a healthy common-divisor set for most pairs, so cell w/h has many
// valid options. Custom papers are allowed via { w_mm, h_mm }.
const PAPER_PRESETS: Record<string, { w_mm: number; h_mm: number }> = {
  A3: { w_mm: 297, h_mm: 420 },
  A4: { w_mm: 210, h_mm: 297 },
  A5: { w_mm: 148, h_mm: 210 },
  B4: { w_mm: 250, h_mm: 353 },
  B5: { w_mm: 176, h_mm: 250 },
};

function paperPxSize(
  paper: Template['canvas']['paper'],
  orientation: 'portrait' | 'landscape' = 'portrait',
): { w: number; h: number } {
  let w: number, h: number;
  if (typeof paper === 'string' && paper in PAPER_PRESETS) {
    const p = PAPER_PRESETS[paper];
    w = p.w_mm * PX_PER_MM;
    h = p.h_mm * PX_PER_MM;
  } else if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
    w = paper.w_mm * PX_PER_MM;
    h = paper.h_mm * PX_PER_MM;
  } else {
    const p = PAPER_PRESETS.A4;
    w = p.w_mm * PX_PER_MM;
    h = p.h_mm * PX_PER_MM;
  }
  return orientation === 'landscape' ? { w: h, h: w } : { w, h };
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
  const paper = 'A4';
  const orientation = 'landscape' as const;
  const px = paperPxSize(paper, orientation);
  const opts = divisorsInRange(px.w).filter((d) => divisorsInRange(px.h).includes(d));
  const cellW = opts.includes(4) ? 4 : opts[0] ?? 1;
  const cellH = cellW;
  return {
    id: makeId('tpl'),
    meta: { name: '未命名模板', description: '', version: 1, tags: [] },
    canvas: {
      cols: px.w / cellW,
      rows: px.h / cellH,
      cell: { w: cellW, h: cellH },
      paper,
      orientation,
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
    view: { zoom: 1 } as { zoom: number },
    panMode: false,
    // Internal: a DOM size accessor that DesignerCanvas registers so the store
    // can compute fit-to-view without a DOM dependency.
    canvasAreaSize: null as null | (() => { w: number; h: number }),
    guides: {
      v: [] as number[],
      h: [] as number[],
      distLabels: [] as Array<{
        kind: 'h' | 'v';
        a: number;
        b: number;
        crossAxis: number;
        value: number;
      }>,
    },
    templateId: null as string | null,
    saveStatus: 'idle' as 'idle' | 'pending' | 'saving' | 'saved' | 'error',
    lastSavedAt: null as number | null,
    saveError: null as string | null,
    publishedVersion: null as number | null,
    hasUnpublishedChanges: false,
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
        if ((el.type === 'barcode' || el.type === 'qr') && el.binding) used.add(el.binding);
      }
      return used;
    },
    // Paper size in pixels — canvas always equals this regardless of cell size
    paperPx: (s): { w: number; h: number } =>
      paperPxSize(s.template.canvas.paper, s.template.canvas.orientation),
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

        // Iteration-4: migrate legacy paper enum values + ensure orientation exists.
        const legacyPaperMap: Record<
          string,
          { paper: Template['canvas']['paper']; orientation: 'portrait' | 'landscape' }
        > = {
          'A3-Landscape': { paper: 'A3', orientation: 'landscape' },
          'A4-Landscape': { paper: 'A4', orientation: 'landscape' },
          'A5-Landscape': { paper: 'A5', orientation: 'landscape' },
          GuardPass: { paper: 'A4', orientation: 'portrait' },
          LogisticLabel: { paper: 'A4', orientation: 'portrait' },
          A6: { paper: 'A5', orientation: 'portrait' },
          Letter: { paper: 'A4', orientation: 'portrait' },
        };
        if (typeof parsed.canvas.paper === 'string' && parsed.canvas.paper in legacyPaperMap) {
          const m = legacyPaperMap[parsed.canvas.paper as string];
          parsed.canvas.paper = m.paper;
          parsed.canvas.orientation = m.orientation;
        }
        // Final guard: if paper is still a string but not in current presets, fall back to A4
        if (typeof parsed.canvas.paper === 'string' && !(parsed.canvas.paper in PAPER_PRESETS)) {
          parsed.canvas.paper = 'A4';
        }
        if (!parsed.canvas.orientation) parsed.canvas.orientation = 'portrait';

        // Iteration-5: migrate legacy barcode→qr split + deprecated 1D symbologies.
        let legacyDeprecatedBarcodeCount = 0;
        for (const el of parsed.elements as TemplateElement[]) {
          if (el.type === 'barcode' && (el as { symbology?: string }).symbology === 'qr') {
            // Convert to new qr type.
            const old = el as TemplateElement & {
              symbology?: string;
              eccLevel?: 'L' | 'M' | 'Q' | 'H';
              showText?: boolean;
              textPosition?: 'top' | 'bottom';
              textFontSize?: number;
            };
            (el as { type: string }).type = 'qr';
            delete old.symbology;
            delete old.showText;
            delete old.textPosition;
            delete old.textFontSize;
            if (!old.eccLevel) old.eccLevel = 'M';
          } else if (
            el.type === 'barcode' &&
            ((el as { symbology?: string }).symbology === 'ean8' ||
              (el as { symbology?: string }).symbology === 'upc-a')
          ) {
            (el as { symbology: string }).symbology = 'code128';
            legacyDeprecatedBarcodeCount += 1;
          }
        }
        if (legacyDeprecatedBarcodeCount > 0) {
          ElMessage.warning(
            `${legacyDeprecatedBarcodeCount} 个条码已从 EAN-8/UPC-A 转换为 Code 128`,
          );
        }

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
        const px = paperPxSize(parsed.canvas.paper, parsed.canvas.orientation ?? 'portrait');
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

        // Step 2.5 — Iteration-3: clamp anchor.w/h up to per-type minimum.
        // This brings iteration-2 drafts (which had no minimums) into compliance.
        for (const el of parsed.elements) {
          const m = minMmFor(el);
          if (el.anchor.w < m.w) el.anchor.w = m.w;
          if (el.anchor.h < m.h) el.anchor.h = m.h;
        }

        // Step 3 — Recompute grid for every element from anchor + new cell.
        for (const el of parsed.elements) {
          recomputeGridFromAnchor(el, parsed.canvas.cell);
        }

        // Step 4 — Iter 10: clamp every element to current paper bounds.
        // Handles stale drafts where elements ended up off-paper due to old buggy
        // resize behavior or paper changes without proper clamping.
        const paperMm = {
          w_mm: px.w / PX_PER_MM,
          h_mm: px.h / PX_PER_MM,
        };
        for (const el of parsed.elements) {
          clampAnchorToPaper(el, paperMm);
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
    registerCanvasArea(reader: () => { w: number; h: number }): void {
      this.canvasAreaSize = reader;
    },
    setGuides(g: {
      v: number[];
      h: number[];
      distLabels: Array<{
        kind: 'h' | 'v';
        a: number;
        b: number;
        crossAxis: number;
        value: number;
      }>;
    }): void {
      this.guides = g;
      // No snapshot — guides are transient, not history-tracked or persisted.
    },
    clearGuides(): void {
      this.guides = { v: [], h: [], distLabels: [] };
    },
    setZoom(z: number): void {
      this.view.zoom = Math.max(0.25, Math.min(4, z));
      // No snapshot — view.zoom is not history-tracked or persisted.
    },
    togglePanMode(): void {
      this.panMode = !this.panMode;
    },
    setPanMode(v: boolean): void {
      this.panMode = v;
    },
    zoomIn(): void {
      this.setZoom(this.view.zoom * 1.25);
    },
    zoomOut(): void {
      this.setZoom(this.view.zoom / 1.25);
    },
    fitView(): void {
      if (!this.canvasAreaSize) return;
      const area = this.canvasAreaSize();
      const px = this.paperPx;
      const padding = 80;
      const fitW = (area.w - padding) / px.w;
      const fitH = (area.h - padding) / px.h;
      const z = Math.max(0.25, Math.min(4, Math.min(fitW, fitH)));
      if (Number.isFinite(z) && z > 0) this.view.zoom = z;
    },
    reset(): void {
      this.template = defaultTemplate();
      this.history = [JSON.stringify(this.template)];
      this.historyIndex = 0;
      this.selectedIds = [];
      this.dirty = false;
      this.persist();
    },
    /**
     * Load template data fetched from the API (e.g. GET /api/templates/:id).
     * Resets history so undo does not cross the load boundary.
     */
    loadTemplate(data: Template): void {
      this.template = data;
      this.history = [JSON.stringify(data)];
      this.historyIndex = 0;
      this.selectedIds = [];
      this.dirty = false;
      this.persist();
      this.saveStatus = 'idle';
      this.saveError = null;
      this.lastSavedAt = null;
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
      const cur = this.template.elements[idx];
      const cell = this.template.canvas.cell;
      this.template.elements[idx] = {
        ...cur,
        grid: { ...cur.grid, c, r },
        anchor: {
          ...cur.anchor,
          x: (c * cell.w) / PX_PER_MM,
          y: (r * cell.h) / PX_PER_MM,
        },
      } as TemplateElement;
    },
    resizeElement(id: string, cs: number, rs: number, c?: number, r?: number): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = this.template.elements[idx];
      const cell = this.template.canvas.cell;
      const newC = c ?? cur.grid.c;
      const newR = r ?? cur.grid.r;
      this.template.elements[idx] = {
        ...cur,
        grid: { c: newC, r: newR, cs, rs },
        anchor: {
          x: (newC * cell.w) / PX_PER_MM,
          y: (newR * cell.h) / PX_PER_MM,
          w: (cs * cell.w) / PX_PER_MM,
          h: (rs * cell.h) / PX_PER_MM,
        },
      } as TemplateElement;
    },
    moveElementMm(id: string, xMm: number, yMm: number): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = this.template.elements[idx];
      const next = {
        ...cur,
        anchor: { ...cur.anchor, x: snapToStep(xMm), y: snapToStep(yMm) },
      } as TemplateElement;
      recomputeGridFromAnchor(next, this.template.canvas.cell);
      this.template.elements[idx] = next;
      // No snapshot — caller commits on pointerup.
    },
    resizeElementMm(id: string, patch: { x?: number; y?: number; w?: number; h?: number }): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = this.template.elements[idx];
      const next = {
        ...cur,
        anchor: {
          x: patch.x !== undefined ? snapToStep(patch.x) : cur.anchor.x,
          y: patch.y !== undefined ? snapToStep(patch.y) : cur.anchor.y,
          w: patch.w !== undefined ? snapToStep(patch.w) : cur.anchor.w,
          h: patch.h !== undefined ? snapToStep(patch.h) : cur.anchor.h,
        },
      } as TemplateElement;
      recomputeGridFromAnchor(next, this.template.canvas.cell);
      this.template.elements[idx] = next;
      // No snapshot — caller commits on pointerup.
    },
    setElementAnchor(id: string, patch: Partial<Anchor>): void {
      const idx = this.template.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = this.template.elements[idx];
      const next = { ...cur, anchor: { ...cur.anchor, ...patch } } as TemplateElement;
      // Clamp to paper bounds — prevents property panel typing from sending element off-canvas
      const paperMm = {
        w_mm: this.paperPx.w / PX_PER_MM,
        h_mm: this.paperPx.h / PX_PER_MM,
      };
      clampAnchorToPaper(next, paperMm);
      recomputeGridFromAnchor(next, this.template.canvas.cell);
      this.template.elements[idx] = next;
      this.snapshot();
    },
    commit(): void {
      this.snapshot();
    },
    setTemplateId(id: string | null): void {
      this.templateId = id;
      this.saveStatus = 'idle';
      this.saveError = null;
    },
    // Internal — called by the debounced wrapper in DesignerView
    async saveToBackend(): Promise<void> {
      if (!this.templateId) return;
      this.saveStatus = 'saving';
      this.saveError = null;
      try {
        const { apiFetch } = await import('../lib/api');
        await apiFetch<{ id: string }>(`/templates/${this.templateId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: this.template.meta.name,
            data: this.template,
          }),
        });
        this.saveStatus = 'saved';
        this.lastSavedAt = Date.now();
        this.dirty = false;
        this.hasUnpublishedChanges = true;
      } catch (e) {
        this.saveStatus = 'error';
        this.saveError = (e as Error).message ?? '保存失败';
      }
    },
    setVersionState(publishedVersion: number | null, hasUnpublishedChanges: boolean): void {
      this.publishedVersion = publishedVersion;
      this.hasUnpublishedChanges = hasUnpublishedChanges;
    },
    async publish(): Promise<{ version: number } | null> {
      if (!this.templateId) return null;
      // 发布前确保草稿已落库（autosave 可能还在 debounce 中）
      if (this.saveStatus === 'pending' || this.dirty) {
        await this.saveToBackend();
      }
      const { apiFetch } = await import('../lib/api');
      const r = await apiFetch<{ version: number; publishedAt: string }>(
        `/templates/${this.templateId}/publish`,
        { method: 'POST' },
      );
      this.publishedVersion = r.version;
      this.hasUnpublishedChanges = false;
      return { version: r.version };
    },
    markPendingSave(): void {
      if (this.templateId && this.saveStatus !== 'saving') {
        this.saveStatus = 'pending';
      }
    },
    deleteElement(id: string): void {
      this.template.elements = this.template.elements.filter((e) => e.id !== id);
      this.selectedIds = this.selectedIds.filter((s) => s !== id);
      this.snapshot();
    },
    deleteAllElements(): void {
      this.template.elements = [];
      this.selectedIds = [];
      this.snapshot();
    },
    // 关键约束：cell.w 必须整除 paperPxW，cell.h 必须整除 paperPxH。
    // 不满足的尺寸直接拒绝；cols/rows 由 paper 与 cell 派生。
    setCellSize(w: number, h: number): void {
      const px = this.paperPx;
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
      const orientation = this.template.canvas.orientation;
      const px = paperPxSize(paper, orientation);
      let { w, h } = this.template.canvas.cell;
      if (px.w % w !== 0 || px.h % h !== 0) {
        const wOpts = divisorsInRange(px.w);
        const hOpts = divisorsInRange(px.h);
        w = wOpts.includes(4) ? 4 : wOpts[0] ?? 1;
        h = hOpts.includes(4) ? 4 : hOpts[0] ?? 1;
      }

      // Resolve new paper in mm so we can clamp anchors — must account for orientation.
      let newMm: { w_mm: number; h_mm: number };
      if (typeof paper === 'string' && paper in PAPER_PRESETS) {
        const p = PAPER_PRESETS[paper];
        newMm =
          orientation === 'landscape'
            ? { w_mm: p.h_mm, h_mm: p.w_mm }
            : { w_mm: p.w_mm, h_mm: p.h_mm };
      } else if (typeof paper === 'object' && paper !== null && 'w_mm' in paper) {
        newMm =
          orientation === 'landscape'
            ? { w_mm: paper.h_mm, h_mm: paper.w_mm }
            : { w_mm: paper.w_mm, h_mm: paper.h_mm };
      } else {
        const p = PAPER_PRESETS.A4;
        newMm =
          orientation === 'landscape'
            ? { w_mm: p.h_mm, h_mm: p.w_mm }
            : { w_mm: p.w_mm, h_mm: p.h_mm };
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
      // Re-fit on paper change since the relative size jumps.
      // Defer to nextTick so Vue has applied the new paperPx to cssVars before
      // fitView reads canvasAreaSize — this prevents a stale-zoom frame where the
      // paper is already new size but the zoom is still calibrated to the old one.
      void nextTick(() => this.fitView());

      if (movedCount > 0) {
        ElMessage.warning(`${movedCount} 个元素已自动移入新画布`);
      }
    },
    rotate(): void {
      this.template.canvas.orientation =
        this.template.canvas.orientation === 'portrait' ? 'landscape' : 'portrait';
      // Re-run setPaper to refresh cell candidates, clamp out-of-bound elements,
      // recompute grid, snapshot, and fit-to-view.
      this.setPaper(this.template.canvas.paper);
    },
    setName(name: string): void {
      this.template.meta.name = name;
      this.snapshot();
    },
    addField(key: string, def: FieldDef): void {
      this.template.schema[key] = def;
      this.snapshot();
    },
    editField(key: string, def: FieldDef): void {
      if (!this.template.schema[key]) return;
      const oldType = this.template.schema[key].type;
      this.template.schema[key] = def;
      // If type changed, scan elements that bind to this key.
      if (oldType !== def.type) {
        let unbound = 0;
        for (const el of this.template.elements) {
          if (!('binding' in el)) continue;
          const elTyped = el as TemplateElement & { binding?: string };
          if (elTyped.binding !== key) continue;
          const allowed = allowedFieldTypesForElement(el.type);
          if (!allowed.includes(def.type)) {
            elTyped.binding = '';
            unbound++;
          }
        }
        if (unbound > 0) {
          ElMessage.warning(`字段类型变化导致 ${unbound} 个元素绑定已自动解除`);
        }
      }
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
      const px = this.paperPx;
      const wOpts = divisorsInRange(px.w);
      const hOpts = divisorsInRange(px.h);
      let common = wOpts.filter((d) => hOpts.includes(d));
      if (common.length === 0) common = [1];
      return common.map((d) => ({ w: d, h: d, cols: px.w / d, rows: px.h / d }));
    },
  },
});
