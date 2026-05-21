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
  store.addField(form.value.key, {
    type: form.value.type,
    label: form.value.label,
    required: form.value.required,
    example: form.value.example || undefined,
  });
  dialogOpen.value = false;
}

function remove(key: string): void {
  if (!window.confirm(`删除字段 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`)) return;
  store.removeField(key);
}
</script>

<template>
  <div class="field-mgr">
    <div class="fm-header">
      <span class="title">数据字段</span>
      <ElButton link size="small" @click="openAdd">+ 添加字段</ElButton>
    </div>

    <div v-if="store.fieldDefs.length === 0" class="empty">尚未声明字段</div>
    <div
      v-for="{ key, def } in store.fieldDefs"
      :key="key"
      class="field-card"
      :class="{ unused: !store.usedFieldKeys.has(key) }"
    >
      <div>
        <span class="k">{{ key }}</span>
        <span class="l">· {{ def.label }}</span>
      </div>
      <div class="meta">
        <span class="t">{{ def.type }}</span>
        <span v-if="def.required" class="req">必填</span>
        <span v-if="!store.usedFieldKeys.has(key)" class="unused-tag">⚠ 未使用</span>
        <ElButton link type="danger" size="small" @click="remove(key)">删除</ElButton>
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
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color);
}
.fm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-placeholder);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 12px 0;
  text-align: center;
}
.field-card {
  padding: 8px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}
.field-card.unused {
  background: #fff8e1;
  border-color: #f0d178;
}
.k {
  font-family: ui-monospace, monospace;
  font-weight: 500;
}
.l {
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}
.meta {
  margin-top: 2px;
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}
.req {
  color: var(--el-color-primary);
}
.unused-tag {
  color: #7d5a00;
}
</style>
