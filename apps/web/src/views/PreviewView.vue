<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';
import { computed, ref, watch } from 'vue';
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
      requestAnimationFrame(() => {
        previewZoom.value = computeFit();
      });
    }
  },
);

const close = (): void => emit('update:modelValue', false);

// --- fit + zoom state ---
const previewZoom = ref(1);
const modalContainerRef = ref<HTMLElement | null>(null);
const zoomOptions = [0.5, 0.75, 1, 1.5, 2];

function computeFit(): number {
  const el = modalContainerRef.value;
  if (!el) return 1;
  const px = store.paperPx;
  const padding = 60;
  const fitW = (el.clientWidth - padding) / px.w;
  const fitH = (el.clientHeight - padding) / px.h;
  return Math.max(0.1, Math.min(2, Math.min(fitW, fitH)));
}

function onFitPreview(): void {
  previewZoom.value = computeFit();
}
function choosePreviewZoom(z: number): void {
  previewZoom.value = z;
}

const paperWrapStyle = computed(() => ({
  width: `${store.paperPx.w * previewZoom.value}px`,
  height: `${store.paperPx.h * previewZoom.value}px`,
  position: 'relative' as const,
}));

const paperStyle = computed(() => ({
  width: `${store.paperPx.w}px`,
  height: `${store.paperPx.h}px`,
  transform: `scale(${previewZoom.value})`,
  transformOrigin: 'top left',
  background: '#fff',
}));
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
      <div class="pv-wrap">
        <div ref="modalContainerRef" class="pv-container">
          <div class="pv-paper-wrap" :style="paperWrapStyle">
            <div class="tp-paper" :style="paperStyle">
              <TemplateRenderer :template="store.template" :data="sampleData" />
            </div>
          </div>
        </div>
        <div class="pv-zoom">
          <button class="pv-zoom-btn" @click="onFitPreview">Fit</button>
          <button
            v-for="z in zoomOptions"
            :key="z"
            class="pv-zoom-btn"
            :class="{ on: Math.abs(previewZoom - z) < 0.01 }"
            @click="choosePreviewZoom(z)"
          >
            {{ Math.round(z * 100) }}%
          </button>
        </div>
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
.pv-wrap {
  position: relative;
  width: 100%;
  height: 70vh;
  border-radius: 8px;
  overflow: hidden;
}
.pv-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--tp-canvas-bg, #f2f2f5);
}
.pv-paper-wrap {
  display: inline-block;
  margin: 30px;
}
.pv-zoom {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 999px;
  padding: 4px 6px;
  box-shadow: 0 2px 12px rgba(20, 20, 30, 0.1);
}
.pv-zoom-btn {
  border: none;
  background: transparent;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--tp-ink-soft, #5e5e66);
}
.pv-zoom-btn:hover {
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.06));
}
.pv-zoom-btn.on {
  background: var(--tp-accent, #6c5ce7);
  color: #fff;
  font-weight: 600;
}
.empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 16px;
}
</style>
