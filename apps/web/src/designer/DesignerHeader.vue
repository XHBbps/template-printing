<script setup lang="ts">
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage } from 'element-plus';
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useDesignerStore } from '../stores/designer';
import CustomPaperDialog from './CustomPaperDialog.vue';
import PreviewView from '../views/PreviewView.vue';

const store = useDesignerStore();
const router = useRouter();

const paperOptions = [
  'A3',
  'A3-Landscape',
  'A4',
  'A4-Landscape',
  'A5',
  'A5-Landscape',
  'A6',
  'B5',
  'Letter',
  'GuardPass',
  'LogisticLabel',
] as const;

const paperLabelMap: Record<string, string> = {
  A3: 'A3',
  'A3-Landscape': 'A3 横',
  A4: 'A4',
  'A4-Landscape': 'A4 横',
  A5: 'A5',
  'A5-Landscape': 'A5 横',
  A6: 'A6',
  B5: 'B5',
  Letter: 'Letter',
  GuardPass: '出门证 (90×60)',
  LogisticLabel: '物流面单 (100×180)',
};

const customDialogOpen = ref(false);

function onCustomPaperConfirm(size: { w_mm: number; h_mm: number }): void {
  store.setPaper(size);
}

const paperLabel = computed(() => {
  const p = store.template.canvas.paper;
  if (typeof p === 'string') return paperLabelMap[p] ?? p;
  return `${p.w_mm}×${p.h_mm}mm`;
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

function exitToHome(): void {
  if (store.dirty) {
    if (!window.confirm('当前模板有未保存改动，确定离开吗？(草稿保留在本地)')) return;
  }
  void router.push('/');
}

function doPrint(): void {
  window.print();
}

const previewOpen = ref(false);
</script>

<template>
  <header class="tp-top-toolbar">
    <button class="tt-btn tt-icon" title="返回" @click="exitToHome">←</button>
    <span class="tt-divider" />

    <button class="tt-btn" :disabled="!store.canUndo" title="撤销 (⌘Z)" @click="store.undo">
      ↶
    </button>
    <button class="tt-btn" :disabled="!store.canRedo" title="重做 (⌘⇧Z)" @click="store.redo">
      ↷
    </button>
    <span class="tt-divider" />

    <ElDropdown trigger="click">
      <button class="tt-btn">📄 {{ paperLabel }}</button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem v-for="p in paperOptions" :key="p" @click="store.setPaper(p)">
            {{ paperLabelMap[p] }}
          </ElDropdownItem>
          <ElDropdownItem divided @click="customDialogOpen = true">⊕ 自定义…</ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <ElDropdown trigger="click">
      <button class="tt-btn">⊞ {{ cellLabel }}</button>
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

    <ElDropdown trigger="click">
      <button class="tt-btn">🔍 {{ zoomLabel }}</button>
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

    <button class="tt-btn" @click="previewOpen = true">👁 预览</button>
    <button
      class="tt-btn tt-primary"
      @click="ElMessage.info('保存到后端在 Plan 3 实现，草稿已存本地')"
    >
      保存
    </button>
    <button class="tt-btn tt-accent" @click="doPrint">🖨 立即打印</button>

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
