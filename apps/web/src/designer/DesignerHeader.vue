<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage, ElMessageBox } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import {
  ArrowLeft,
  Undo2,
  Redo2,
  FileText,
  Grid3x3,
  RotateCw,
  ZoomIn,
  Eye,
  Save,
  Printer,
  Plus,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useDesignerStore } from '../stores/designer';
import CustomPaperDialog from './CustomPaperDialog.vue';
import PreviewView from '../views/PreviewView.vue';

const store = useDesignerStore();
const router = useRouter();

const paperOptions = ['A3', 'A4', 'A5', 'B4', 'B5'] as const;

const paperLabelMap: Record<string, string> = {
  A3: 'A3',
  A4: 'A4',
  A5: 'A5',
  B4: 'B4',
  B5: 'B5',
};

const customDialogOpen = ref(false);

function onCustomPaperConfirm(size: { w_mm: number; h_mm: number }): void {
  store.setPaper(size);
}

const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  const o = store.template.canvas.orientation;
  if (typeof p === 'string') {
    return o === 'landscape' ? `${paperLabelMap[p]} 横` : paperLabelMap[p] ?? p;
  }
  const dim = `${p.w_mm}×${p.h_mm}mm`;
  return o === 'landscape' ? `${dim} 横` : dim;
});

const cellLabel = computed(() => `${store.template.canvas.cell.w} px`);

const validCells = computed(() => store.validCellOptions());

const zoomLabel = computed(() => `${Math.round(store.view.zoom * 100)}%`);
const zoomOptions = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
function chooseZoom(z: number): void {
  store.setZoom(z);
}
function onFit(): void {
  store.fitView();
}

function chooseCell(w: number, h: number): void {
  if (w === store.template.canvas.cell.w && h === store.template.canvas.cell.h) return;
  store.isResizing = true;
  store.setCellSize(w, h);
  void nextTick(() => {
    setTimeout(() => {
      store.isResizing = false;
    }, 420);
  });
}

async function exitToHome(): Promise<void> {
  if (store.dirty) {
    try {
      await ElMessageBox.confirm('当前模板有未保存改动，确定离开吗？(草稿保留在本地)', '离开', {
        confirmButtonText: '离开',
        cancelButtonText: '继续编辑',
        type: 'warning',
        center: true,
      });
    } catch {
      return;
    }
  }
  void router.push('/');
}

let savedZoom = 1;
function onBeforePrint(): void {
  savedZoom = store.view.zoom;
  store.setZoom(1);
}
function onAfterPrint(): void {
  store.setZoom(savedZoom);
}
onMounted(() => {
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', onBeforePrint);
  window.removeEventListener('afterprint', onAfterPrint);
});

async function doPrint(): Promise<void> {
  const prevZoom = store.view.zoom;
  if (prevZoom !== 1) {
    store.setZoom(1);
    await nextTick();
  }
  window.print();
  if (prevZoom !== 1) {
    store.setZoom(prevZoom);
  }
}

function openCustomDialog(): void {
  customDialogOpen.value = true;
}

const previewOpen = ref(false);
</script>

<template>
  <header class="tp-top-toolbar">
    <button class="tt-btn tt-icon" title="返回" @click="exitToHome">
      <ArrowLeft :size="16" :stroke-width="2" />
    </button>
    <span class="tt-divider" />

    <button class="tt-btn" :disabled="!store.canUndo" title="撤销 (⌘Z)" @click="store.undo">
      <Undo2 :size="16" :stroke-width="2" />
    </button>
    <button class="tt-btn" :disabled="!store.canRedo" title="重做 (⌘⇧Z)" @click="store.redo">
      <Redo2 :size="16" :stroke-width="2" />
    </button>
    <span class="tt-divider" />

    <ElDropdown trigger="click">
      <button class="tt-btn">
        <FileText :size="16" :stroke-width="2" />
        {{ paperLabel }}
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem v-for="p in paperOptions" :key="p" @click="store.setPaper(p)">
            {{ paperLabelMap[p] }}
          </ElDropdownItem>
          <ElDropdownItem divided @click="openCustomDialog">
            <Plus :size="14" :stroke-width="2" style="margin-right: 6px" />
            自定义…
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <ElDropdown trigger="click">
      <button class="tt-btn">
        <Grid3x3 :size="16" :stroke-width="2" />
        {{ cellLabel }}
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="opt in validCells"
            :key="`${opt.w}x${opt.h}`"
            @click="chooseCell(opt.w, opt.h)"
          >
            {{ opt.w }} px
            <span style="color: #999; margin-left: 6px">({{ opt.cols }}×{{ opt.rows }} 格)</span>
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <button class="tt-btn" title="旋转 90°" @click="store.rotate()">
      <RotateCw :size="16" :stroke-width="2" />
    </button>

    <ElDropdown trigger="click">
      <button class="tt-btn">
        <ZoomIn :size="16" :stroke-width="2" />
        {{ zoomLabel }}
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem @click="onFit">Fit (自动适配)</ElDropdownItem>
          <ElDropdownItem v-for="z in zoomOptions" :key="z" @click="chooseZoom(z)">
            {{ Math.round(z * 100) }}%
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <span class="tt-spacer" />

    <button class="tt-btn" @click="previewOpen = true">
      <Eye :size="16" :stroke-width="2" />
      预览
    </button>
    <button
      class="tt-btn tt-primary"
      @click="ElMessage.info('保存到后端在 Plan 3 实现，草稿已存本地')"
    >
      <Save :size="16" :stroke-width="2" />
      保存
    </button>
    <button class="tt-btn tt-accent" @click="doPrint">
      <Printer :size="16" :stroke-width="2" />
      立即打印
    </button>

    <CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />
  </header>
  <PreviewView v-model="previewOpen" />
</template>

<style scoped>
.tt-btn {
  height: 32px;
  padding: 0 14px;
  border: none;
  background: transparent;
  border-radius: var(--tp-radius-pill);
  font-size: 12.5px;
  color: var(--tp-ink-soft);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  font-family: inherit;
  transition: all 120ms ease;
}
.tt-btn:hover:not(:disabled) {
  background: var(--tp-field-bg);
  color: var(--tp-accent);
}
.tt-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tt-icon {
  width: 32px;
  padding: 0;
  justify-content: center;
  font-size: 15px;
}
.tt-primary {
  background: var(--tp-accent-bg);
  color: var(--tp-accent-ink);
  font-weight: 600;
}
.tt-primary:hover:not(:disabled) {
  background: var(--tp-accent);
  color: #fff;
}
.tt-accent {
  background: var(--tp-accent);
  color: #fff;
  font-weight: 600;
  box-shadow: var(--tp-accent-shadow);
}
.tt-accent:hover:not(:disabled) {
  background: #5847d4;
  color: #fff;
}
.tt-divider {
  width: 1px;
  height: 20px;
  background: var(--tp-line-strong);
  margin: 0 8px;
}
</style>
