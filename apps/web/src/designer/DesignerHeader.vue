<script setup lang="ts">
import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElInputNumber,
  ElMessage,
} from 'element-plus';
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useDesignerStore } from '../stores/designer';
import PreviewView from '../views/PreviewView.vue';

const store = useDesignerStore();
const router = useRouter();

const paperOptions = ['A4', 'A4-Landscape', 'A5', 'A5-Landscape'] as const;

const cellW = ref(store.template.canvas.cell.w);
const cellH = ref(store.template.canvas.cell.h);

// Keep local refs in sync if store updates via undo/redo/restore
watch(
  () => [store.template.canvas.cell.w, store.template.canvas.cell.h],
  ([w, h]) => {
    cellW.value = w;
    cellH.value = h;
  },
);

function applyCellSize(): void {
  if (
    cellW.value === store.template.canvas.cell.w &&
    cellH.value === store.template.canvas.cell.h
  ) {
    return;
  }
  store.isResizing = true;
  store.setCellSize(cellW.value, cellH.value);
  void nextTick(() => {
    setTimeout(() => {
      store.isResizing = false;
    }, 420);
  });
}

function exitToHome(): void {
  if (store.dirty) {
    if (!window.confirm('当前模板有未保存改动，确定离开吗？(草稿保留在本地)')) return;
  }
  void router.push('/');
}

const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  return typeof p === 'string' ? p : `${p.w_mm}×${p.h_mm} mm`;
});

function doPrint(): void {
  window.print();
}

const previewOpen = ref(false);
</script>

<template>
  <header class="designer-header">
    <ElButton link size="small" @click="exitToHome">← 返回</ElButton>
    <ElInput
      v-model="store.template.meta.name"
      size="small"
      placeholder="模板名"
      style="width: 200px; margin-left: 8px"
    />

    <span class="dh-divider" />

    <ElButton :disabled="!store.canUndo" link size="small" @click="store.undo">↶ 撤销</ElButton>
    <ElButton :disabled="!store.canRedo" link size="small" @click="store.redo">↷ 重做</ElButton>

    <span class="dh-divider" />

    <span class="dh-label">cell</span>
    <ElInputNumber
      v-model="cellW"
      :min="1"
      :max="40"
      size="small"
      controls-position="right"
      style="width: 70px"
    />
    <span class="dh-x">×</span>
    <ElInputNumber
      v-model="cellH"
      :min="1"
      :max="40"
      size="small"
      controls-position="right"
      style="width: 70px"
    />
    <span class="dh-label">px</span>
    <ElButton size="small" @click="applyCellSize">应用</ElButton>

    <span class="dh-divider" />

    <ElDropdown trigger="click">
      <ElButton size="small">{{ paperLabel }}</ElButton>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem v-for="p in paperOptions" :key="p" @click="store.setPaper(p)">
            {{ p }}
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <span class="dh-spacer" />

    <ElButton size="small" @click="previewOpen = true">👁 预览</ElButton>
    <ElButton
      type="primary"
      size="small"
      @click="ElMessage.info('保存到后端在 Plan 3 实现，草稿已存本地')"
    >
      保存
    </ElButton>
    <ElButton type="primary" plain size="small" @click="doPrint">立即打印</ElButton>
  </header>
  <PreviewView v-model="previewOpen" />
</template>

<style scoped>
.designer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 100%;
}
.dh-divider {
  width: 1px;
  height: 20px;
  background: var(--el-border-color);
  margin: 0 4px;
}
.dh-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.dh-x {
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}
.dh-spacer {
  flex: 1;
}
</style>
