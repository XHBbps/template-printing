<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';
import { ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { TemplateRenderer } from '@template-printing/template-renderer';

import { useDesignerStore } from '../stores/designer';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const store = useDesignerStore();
const sampleData = ref<Record<string, unknown>>({});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      const data: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(store.template.schema)) {
        data[key] = def.example ?? '';
      }
      sampleData.value = data;
    }
  },
);

const close = (): void => emit('update:modelValue', false);
</script>

<template>
  <ElDialog :model-value="props.modelValue" title="预览模板" width="80vw" @close="close">
    <div class="preview-layout">
      <div class="data-form">
        <h4>示例数据</h4>
        <ElForm v-if="store.fieldDefs.length > 0" label-position="top">
          <ElFormItem
            v-for="(def, key) in store.template.schema"
            :key="key"
            :label="`${key} (${def.label})`"
          >
            <ElInput
              :model-value="String(sampleData[key] ?? '')"
              size="small"
              @update:model-value="(v) => (sampleData[key] = v)"
            />
          </ElFormItem>
        </ElForm>
        <p v-else class="empty">未声明数据字段</p>
      </div>
      <div class="preview-canvas">
        <TemplateRenderer :template="store.template" :data="sampleData" />
      </div>
    </div>
    <template #footer>
      <ElButton @click="close">关闭</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.preview-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  max-height: 70vh;
}
.data-form {
  overflow-y: auto;
  padding-right: 8px;
  border-right: 1px solid var(--el-border-color);
}
.preview-canvas {
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 16px;
  background: #f0f2f5;
}
.empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 16px;
}
</style>
