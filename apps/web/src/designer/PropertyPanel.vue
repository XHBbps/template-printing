<script setup lang="ts">
import { ElButton, ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus';
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
  store.updateElement(sel.value.id, {
    grid: { ...sel.value.grid, [field]: Math.max(min, val) },
  } as Partial<TemplateElement>);
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
  <div class="prop-panel">
    <div class="block-title">
      属性 <span v-if="sel" class="hint">· 已选 {{ store.selectedIds.length }} 个</span>
    </div>

    <div v-if="!sel" class="empty">未选中任何元素</div>

    <template v-else>
      <div class="row">
        <span class="lbl">类型</span>
        <span class="val mono">{{ sel.type }}</span>
      </div>
      <div class="row">
        <span class="lbl">位置 (格)</span>
        <span class="val">
          c<ElInputNumber
            size="small"
            :model-value="sel.grid.c"
            :min="0"
            controls-position="right"
            style="width: 70px; margin-left: 4px"
            @change="(v: number | undefined) => setGridPos('c', v ?? 0)"
          />
          r<ElInputNumber
            size="small"
            :model-value="sel.grid.r"
            :min="0"
            controls-position="right"
            style="width: 70px; margin-left: 4px"
            @change="(v: number | undefined) => setGridPos('r', v ?? 0)"
          />
        </span>
      </div>
      <div class="row">
        <span class="lbl">尺寸 (格)</span>
        <span class="val">
          <ElInputNumber
            size="small"
            :model-value="sel.grid.cs"
            :min="1"
            controls-position="right"
            style="width: 70px"
            @change="(v: number | undefined) => setGridPos('cs', v ?? 1)"
          />
          ×
          <ElInputNumber
            size="small"
            :model-value="sel.grid.rs"
            :min="1"
            controls-position="right"
            style="width: 70px"
            @change="(v: number | undefined) => setGridPos('rs', v ?? 1)"
          />
        </span>
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
    </template>
  </div>
</template>

<style scoped>
.prop-panel {
  font-size: 12px;
}
.block-title {
  padding: 12px 16px 6px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.hint {
  font-weight: normal;
  text-transform: none;
  letter-spacing: 0;
  color: var(--el-text-color-secondary);
}
.empty {
  padding: 16px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
}
.lbl {
  color: var(--el-text-color-secondary);
  min-width: 60px;
}
.val {
  color: var(--el-text-color-primary);
}
.mono {
  font-family: ui-monospace, monospace;
}
</style>
