<script setup lang="ts">
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
} from 'element-plus';
import { ref } from 'vue';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

const dialogOpen = ref(false);
const form = ref({
  key: '',
  label: '',
  type: 'string' as 'string' | 'number' | 'date' | 'array',
  required: false,
  example: '',
});

function openAdd(): void {
  form.value = { key: '', label: '', type: 'string', required: false, example: '' };
  dialogOpen.value = true;
}

function submit(): void {
  if (!form.value.key || !form.value.label) {
    ElMessage.warning('key 和 label 都必须填');
    return;
  }
  if (store.template.schema[form.value.key]) {
    ElMessage.error(`字段 "${form.value.key}" 已存在`);
    return;
  }
  const f = form.value;
  const base = { label: f.label, required: f.required, example: f.example || undefined };
  let def;
  if (f.type === 'string') {
    def = { type: 'string' as const, ...base };
  } else if (f.type === 'number') {
    def = { type: 'number' as const, ...base, thousands: false };
  } else if (f.type === 'date') {
    def = { type: 'date' as const, ...base, format: 'YYYY-MM-DD' };
  } else {
    def = { type: 'array' as const, ...base };
  }
  store.addField(f.key, def);
  dialogOpen.value = false;
}

function remove(key: string): void {
  if (!window.confirm(`删除字段 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`)) return;
  store.removeField(key);
}
</script>

<template>
  <div class="tp-section-top field-mgr">
    <div class="tp-sub-head">
      <span class="tp-sub-title">数据字段 · {{ store.fieldDefs.length }}</span>
      <button class="tp-sub-add" title="添加字段" @click="openAdd">+</button>
    </div>
    <div class="fm-body">
      <div v-if="store.fieldDefs.length === 0" class="empty">尚未声明字段<br />点击 + 添加</div>
      <div
        v-for="{ key, def } in store.fieldDefs"
        :key="key"
        class="field-card"
        :class="{ unused: !store.usedFieldKeys.has(key) }"
      >
        <div class="card-row">
          <span class="k">{{ key }}</span>
          <span class="t">{{ def.type }}</span>
        </div>
        <div class="card-row card-row-sub">
          <span class="l">{{ def.label }}</span>
          <span v-if="def.required" class="req">必填</span>
          <span v-if="!store.usedFieldKeys.has(key)" class="unused-tag">未使用</span>
          <button class="del" @click="remove(key)" title="删除">×</button>
        </div>
      </div>
    </div>

    <ElDialog v-model="dialogOpen" title="添加字段" width="360px">
      <ElForm label-position="top">
        <ElFormItem label="key (英文/拼音)">
          <ElInput v-model="form.key" />
        </ElFormItem>
        <ElFormItem label="label (中文显示名)">
          <ElInput v-model="form.label" />
        </ElFormItem>
        <ElFormItem label="类型">
          <ElSelect v-model="form.type">
            <ElOption label="string" value="string" />
            <ElOption label="number" value="number" />
            <ElOption label="date" value="date" />
            <ElOption label="array" value="array" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="示例值">
          <ElInput v-model="form.example" />
        </ElFormItem>
        <ElButton type="primary" style="width: 100%" @click="submit">添加</ElButton>
      </ElForm>
    </ElDialog>
  </div>
</template>

<style scoped>
.field-mgr {
  min-height: 0;
}
.fm-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 12px;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--tp-ink-faint);
  font-size: 12px;
  line-height: 1.7;
}
.field-card {
  margin-bottom: 6px;
  padding: 8px 10px;
  border-radius: var(--tp-radius-item);
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  font-size: 12px;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}
.field-card:hover {
  border-color: var(--tp-accent);
  background: var(--tp-field-bg);
}
.field-card.unused {
  background: var(--tp-warn-bg);
  border-color: var(--tp-warn-line);
}
.card-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.card-row-sub {
  margin-top: 2px;
}
.k {
  font-family: ui-monospace, monospace;
  font-weight: 600;
  color: var(--tp-ink);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t {
  font-size: 10px;
  background: var(--tp-accent-bg);
  color: var(--tp-accent-ink);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}
.l {
  flex: 1;
  min-width: 0;
  color: var(--tp-ink-soft);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.req {
  font-size: 10px;
  color: var(--tp-accent-ink);
  background: var(--tp-accent-bg);
  padding: 0 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.unused-tag {
  font-size: 10px;
  color: var(--tp-warn-ink);
  flex-shrink: 0;
}
.del {
  border: none;
  background: transparent;
  color: var(--tp-ink-faint);
  cursor: pointer;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}
.del:hover {
  background: var(--tp-field-bg);
  color: #d94f4f;
}
</style>
