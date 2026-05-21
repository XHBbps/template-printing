import type { Template, TemplateElement, FieldDefSchema } from '@template-printing/schema';
import { defineStore } from 'pinia';
// eslint-disable-next-line import/no-unresolved
import type { z } from 'zod';

type FieldDef = z.infer<typeof FieldDefSchema>;

const STORAGE_KEY = 'tp_designer_draft';
const HISTORY_LIMIT = 50;

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultBorder() {
  const side = { show: false, width: 1, style: 'solid' as const, color: '#1f2328' };
  return { top: { ...side }, right: { ...side }, bottom: { ...side }, left: { ...side } };
}

// Used by element library when creating new elements (Task 9 — ElementLibrary)
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
  return {
    id: makeId('tpl'),
    meta: { name: '未命名模板', description: '', version: 1, tags: [] },
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
    setCellSize(w: number, h: number): void {
      this.template.canvas.cell = { w, h };
      this.snapshot();
    },
    setCanvasSize(cols: number, rows: number): void {
      this.template.canvas.cols = cols;
      this.template.canvas.rows = rows;
      this.snapshot();
    },
    setPaper(paper: Template['canvas']['paper']): void {
      this.template.canvas.paper = paper;
      this.snapshot();
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
  },
});
