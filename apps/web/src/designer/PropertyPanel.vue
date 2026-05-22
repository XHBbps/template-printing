<script setup lang="ts">
import { ElButton, ElInput, ElOption, ElSelect } from 'element-plus';
import { computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle, TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';
import BorderControl from './BorderControl.vue';
import PaddingControl from './PaddingControl.vue';

const store = useDesignerStore();

const sel = computed<TemplateElement | null>(() => store.selectedElement);

function updateStyleBorder(v: ElementStyle['border']): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, border: v },
  } as Partial<TemplateElement>);
}

function updateStylePadding(v: ElementStyle['padding']): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, padding: v },
  } as Partial<TemplateElement>);
}

function onAnchorInput(key: 'x' | 'y' | 'w' | 'h', e: Event): void {
  if (!sel.value) return;
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  const min = key === 'w' || key === 'h' ? 0.25 : 0;
  store.setElementAnchor(sel.value.id, { [key]: Math.max(min, v) });
}

function setTextContent(v: string): void {
  if (!sel.value || sel.value.type !== 'text') return;
  store.updateElement(sel.value.id, { content: { static: v } } as Partial<TemplateElement>);
}

function setBinding(v: string): void {
  if (!sel.value) return;
  if (sel.value.type === 'field' || sel.value.type === 'table') {
    store.updateElement(sel.value.id, { binding: v } as Partial<TemplateElement>);
  }
}

function del(): void {
  if (!sel.value) return;
  store.deleteElement(sel.value.id);
}

function updateStyle(patch: Partial<ElementStyle>): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, ...patch },
  } as Partial<TemplateElement>);
}

function isTextish(el: TemplateElement | null): boolean {
  if (!el) return false;
  return ['text', 'field', 'autonumber', 'system', 'table'].includes(el.type);
}
</script>

<template>
  <div class="tp-section-bottom prop-panel">
    <div class="tp-sub-head">
      <span class="tp-sub-title">属性</span>
      <span v-if="sel" class="tp-sub-hint">已选 {{ store.selectedIds.length }} 个</span>
    </div>

    <div v-if="!sel" class="empty">未选中任何元素</div>

    <div v-else class="prop-body">
      <div class="row">
        <span class="lbl">类型</span>
        <span class="val mono">{{ sel.type }}</span>
      </div>

      <!-- 位置 — anchor.x / anchor.y in mm -->
      <div class="row row-axis">
        <span class="lbl">位置</span>
        <div class="axis-pair">
          <label class="axis">
            <span class="axis-lbl">列</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.x.toFixed(2)"
              step="0.25"
              min="0"
              @input="(e: Event) => onAnchorInput('x', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
          <label class="axis">
            <span class="axis-lbl">行</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.y.toFixed(2)"
              step="0.25"
              min="0"
              @input="(e: Event) => onAnchorInput('y', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
        </div>
      </div>
      <div class="row row-badge">
        <span class="lbl"></span>
        <span class="cell-eq"
          >≈ {{ sel.grid.c }} × {{ sel.grid.r }} 格 @ cell={{
            store.template.canvas.cell.w
          }}px</span
        >
      </div>

      <!-- 尺寸 — anchor.w / anchor.h in mm -->
      <div class="row row-axis">
        <span class="lbl">尺寸</span>
        <div class="axis-pair">
          <label class="axis">
            <span class="axis-lbl">宽</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.w.toFixed(2)"
              step="0.25"
              min="0.25"
              @input="(e: Event) => onAnchorInput('w', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
          <label class="axis">
            <span class="axis-lbl">高</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.h.toFixed(2)"
              step="0.25"
              min="0.25"
              @input="(e: Event) => onAnchorInput('h', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
        </div>
      </div>
      <div class="row row-badge">
        <span class="lbl"></span>
        <span class="cell-eq">≈ {{ sel.grid.cs }} × {{ sel.grid.rs }} 格</span>
      </div>

      <div v-if="sel.type === 'text'" class="row">
        <span class="lbl">内容</span>
        <ElInput
          size="small"
          :model-value="sel.content.static"
          style="flex: 1"
          @update:model-value="setTextContent"
        />
      </div>
      <div v-if="sel.type === 'field' || sel.type === 'table'" class="row">
        <span class="lbl">绑定</span>
        <ElSelect size="small" :model-value="sel.binding" style="flex: 1" @change="setBinding">
          <ElOption
            v-for="f in store.fieldDefs"
            :key="f.key"
            :value="f.key"
            :label="`${f.key} (${f.def.label})`"
          />
        </ElSelect>
      </div>

      <div v-if="isTextish(sel)" class="style-block">
        <div class="style-title">样式 · 基础</div>

        <div class="srow">
          <span class="slbl">颜色</span>
          <input
            type="color"
            :value="sel.style.color ?? '#1F1F23'"
            @input="(e: Event) => updateStyle({ color: (e.target as HTMLInputElement).value })"
          />
          <span class="sval mono">{{ sel.style.color ?? '#1F1F23' }}</span>
        </div>

        <div class="srow">
          <span class="slbl">字号</span>
          <input
            type="number"
            :value="sel.style.fontSize ?? 14"
            min="6"
            max="72"
            step="1"
            class="snum"
            @input="
              (e: Event) => updateStyle({ fontSize: Number((e.target as HTMLInputElement).value) })
            "
          />
          <span class="sval">px</span>
        </div>

        <div class="srow">
          <span class="slbl">粗细</span>
          <select
            :value="sel.style.fontWeight ?? 400"
            class="ssel"
            @change="
              (e: Event) =>
                updateStyle({
                  fontWeight: Number((e.target as HTMLSelectElement).value) as
                    | 400
                    | 500
                    | 600
                    | 700,
                })
            "
          >
            <option :value="400">常规 400</option>
            <option :value="500">中等 500</option>
            <option :value="600">半粗 600</option>
            <option :value="700">粗体 700</option>
          </select>
        </div>

        <div class="srow">
          <span class="slbl">对齐</span>
          <div class="seg">
            <button
              v-for="a in ['left', 'center', 'right', 'justify'] as const"
              :key="a"
              :class="{ on: sel.style.textAlign === a }"
              @click="updateStyle({ textAlign: a })"
            >
              {{ { left: '左', center: '中', right: '右', justify: '端' }[a] }}
            </button>
          </div>
        </div>
      </div>

      <BorderControl :model-value="sel.style.border" @update:model-value="updateStyleBorder" />
      <PaddingControl :model-value="sel.style.padding" @update:model-value="updateStylePadding" />

      <div style="padding: 12px 16px">
        <ElButton type="danger" plain size="small" style="width: 100%" @click="del">
          删除元素
        </ElButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prop-panel {
  font-size: 12px;
  overflow-y: auto;
}
.prop-body {
  padding: 4px 0 12px;
}
.empty {
  padding: 32px 16px;
  color: var(--tp-ink-faint);
  text-align: center;
  font-size: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
}
.row-axis {
  gap: 8px;
}
.lbl {
  color: var(--tp-ink-soft);
  min-width: 36px;
  font-size: 11px;
  letter-spacing: 0.03em;
}
.val {
  color: var(--tp-ink);
}
.mono {
  font-family: ui-monospace, monospace;
}

/* Axis pill — 列/行/宽/高 (#6) */
.axis-pair {
  display: flex;
  gap: 6px;
  flex: 1;
}
.axis {
  flex: 1;
  display: flex;
  align-items: stretch;
  background: var(--tp-field-bg);
  border: 1px solid transparent;
  border-radius: var(--tp-radius-item);
  overflow: hidden;
  transition: border-color 120ms ease;
  min-width: 0;
}
.axis:focus-within {
  border-color: var(--tp-accent);
  background: #fff;
}
.axis-lbl {
  background: var(--tp-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.axis-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--tp-ink);
  outline: none;
  font-family: ui-monospace, monospace;
  min-width: 0;
  width: 100%;
}
.axis-input::-webkit-outer-spin-button,
.axis-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.axis-input[type='number'] {
  -moz-appearance: textfield;
}
.axis-unit {
  background: transparent;
  color: var(--tp-ink-faint);
  font-size: 10px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.row-badge {
  padding: 0 14px 4px;
  font-size: 10.5px;
  color: var(--tp-ink-faint);
}
.row-badge .lbl {
  min-width: 36px;
}
.cell-eq {
  font-family: ui-monospace, monospace;
}
.style-block {
  padding: 12px 14px;
  border-bottom: 1px solid var(--tp-line);
}
.style-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--tp-ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
.srow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.slbl {
  width: 36px;
  font-size: 11px;
  color: var(--tp-ink-soft);
}
.sval {
  font-size: 11px;
  color: var(--tp-ink-soft);
}
.snum,
.ssel {
  padding: 3px 6px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 4px;
  font-size: 12px;
  min-width: 80px;
}
.seg {
  display: inline-flex;
  gap: 4px;
}
.seg button {
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--tp-ink-soft);
}
.seg button.on {
  background: var(--tp-accent);
  color: #fff;
  border-color: var(--tp-accent);
}
</style>
