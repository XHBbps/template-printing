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

function setGridPos(field: 'c' | 'r' | 'cs' | 'rs', val: number): void {
  if (!sel.value) return;
  const min = field === 'cs' || field === 'rs' ? 1 : 0;
  const next = Math.max(min, Math.floor(val) || min);
  store.updateElement(sel.value.id, {
    grid: { ...sel.value.grid, [field]: next },
  } as Partial<TemplateElement>);
}

function onAxisInput(field: 'c' | 'r' | 'cs' | 'rs', e: Event): void {
  const target = e.target as HTMLInputElement;
  const v = Number(target.value);
  if (Number.isFinite(v)) setGridPos(field, v);
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

      <!-- 位置 — 列 / 行 axis pills (#6) -->
      <div class="row row-axis">
        <span class="lbl">位置</span>
        <div class="axis-pair">
          <label class="axis">
            <span class="axis-lbl">列</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.grid.c"
              min="0"
              @input="(e: Event) => onAxisInput('c', e)"
            />
          </label>
          <label class="axis">
            <span class="axis-lbl">行</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.grid.r"
              min="0"
              @input="(e: Event) => onAxisInput('r', e)"
            />
          </label>
        </div>
      </div>

      <!-- 尺寸 — 宽 / 高 axis pills -->
      <div class="row row-axis">
        <span class="lbl">尺寸</span>
        <div class="axis-pair">
          <label class="axis">
            <span class="axis-lbl">宽</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.grid.cs"
              min="1"
              @input="(e: Event) => onAxisInput('cs', e)"
            />
          </label>
          <label class="axis">
            <span class="axis-lbl">高</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.grid.rs"
              min="1"
              @input="(e: Event) => onAxisInput('rs', e)"
            />
          </label>
        </div>
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
</style>
