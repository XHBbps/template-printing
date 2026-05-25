<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { FileText, Grid3x3, RotateCw, Eye, Save, Printer, Plus } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import { useDesignerStore } from '../stores/designer';
import CustomPaperDialog from './CustomPaperDialog.vue';
import PreviewView from '../views/PreviewView.vue';

const store = useDesignerStore();

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
  const PX_PER_MM = 4;
  const paperMm = {
    w: store.paperPx.w / PX_PER_MM,
    h: store.paperPx.h / PX_PER_MM,
  };
  const styleEl = document.createElement('style');
  styleEl.id = '__tp_print_page__';
  styleEl.textContent = `@page { size: ${paperMm.w}mm ${paperMm.h}mm; margin: 0; }`;
  document.head.appendChild(styleEl);

  if (prevZoom !== 1) {
    store.setZoom(1);
    await nextTick();
  }
  window.print();

  styleEl.remove();
  if (prevZoom !== 1) {
    store.setZoom(prevZoom);
  }
}

function openCustomDialog(): void {
  customDialogOpen.value = true;
}

const previewOpen = ref(false);

const saveStatusText = computed(() => {
  if (!store.templateId) return '';
  if (store.saveStatus === 'saving') return '保存中…';
  if (store.saveStatus === 'pending') return '未保存';
  if (store.saveStatus === 'error') return '保存失败 · 点击重试';
  if (store.saveStatus === 'saved') return '已保存';
  return '';
});

const saveStateClass = computed(() => {
  if (store.saveStatus === 'error') return 'is-error';
  if (store.saveStatus === 'saving' || store.saveStatus === 'pending') return 'is-warn';
  return 'is-ok';
});

function retrySave(): void {
  if (store.saveStatus === 'error') void store.saveToBackend();
}
</script>

<template>
  <header class="tp-top-toolbar">
    <ElDropdown trigger="click">
      <button class="tt-chip" type="button">
        <FileText :size="14" :stroke-width="1.5" />
        <span>{{ paperLabel }}</span>
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem v-for="p in paperOptions" :key="p" @click="store.setPaper(p)">
            {{ paperLabelMap[p] }}
          </ElDropdownItem>
          <ElDropdownItem divided @click="openCustomDialog">
            <Plus :size="14" :stroke-width="1.5" style="margin-right: 6px" />
            自定义…
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <ElDropdown trigger="click">
      <button class="tt-chip" type="button">
        <Grid3x3 :size="14" :stroke-width="1.5" />
        <span class="num">{{ cellLabel }}</span>
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="opt in validCells"
            :key="`${opt.w}x${opt.h}`"
            @click="chooseCell(opt.w, opt.h)"
          >
            {{ opt.w }} px
            <span style="color: var(--fg-3); margin-left: 6px">
              ({{ opt.cols }}×{{ opt.rows }} 格)
            </span>
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>

    <button class="tt-chip tt-chip--icon" type="button" title="旋转 90°" @click="store.rotate()">
      <RotateCw :size="14" :stroke-width="1.5" />
    </button>

    <span class="tt-spacer" />

    <span
      v-if="saveStatusText"
      class="tt-save-state"
      :class="saveStateClass"
      :style="{ cursor: store.saveStatus === 'error' ? 'pointer' : 'default' }"
      @click="retrySave"
    >
      <span class="dot"></span>
      <span class="lbl">{{ saveStatusText }}</span>
    </span>

    <button class="tt-ghost" type="button" @click="previewOpen = true">
      <Eye :size="14" :stroke-width="1.5" />
      预览
    </button>
    <button
      class="tt-btn-secondary"
      type="button"
      :disabled="store.saveStatus === 'saving'"
      @click="store.saveToBackend"
    >
      <Save :size="14" :stroke-width="1.5" />
      保存
    </button>
    <button class="tt-btn-primary" type="button" @click="doPrint">
      <Printer :size="14" :stroke-width="1.5" />
      立即打印
    </button>

    <CustomPaperDialog v-model="customDialogOpen" @confirm="onCustomPaperConfirm" />
  </header>
  <PreviewView v-model="previewOpen" />
</template>

<style scoped>
/* ============ Chips（A4 / 4 px / ⟳） ============ */
.tt-chip {
  height: 36px;
  padding: 0 12px;
  background: var(--paper-white);
  color: var(--ink);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  font-family: var(--font-sans);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--dur-fast) var(--ease-default);
}
.tt-chip:hover:not(:disabled) {
  border-color: var(--yangli-graphite);
}
.tt-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tt-chip > svg {
  color: var(--fg-2);
  flex-shrink: 0;
}
.tt-chip .num {
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.tt-chip--icon {
  width: 36px;
  padding: 0;
  justify-content: center;
}

/* ============ Save state（• dot + 文字） ============ */
.tt-save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--fg-3);
  user-select: none;
  white-space: nowrap;
}
.tt-save-state .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
}
.tt-save-state.is-ok .dot {
  background: #0f8c5a;
}
.tt-save-state.is-warn .dot {
  background: #c68a00;
}
.tt-save-state.is-error .dot {
  background: var(--yangli-red);
}
.tt-save-state.is-error {
  color: var(--yangli-red);
}

/* ============ 预览 ghost ============ */
.tt-ghost {
  height: 36px;
  padding: 0 12px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--fg-2);
  border-radius: var(--radius-2);
  font-family: var(--font-sans);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-default);
}
.tt-ghost:hover {
  color: var(--yangli-red);
}

/* ============ 保存 secondary ============ */
.tt-btn-secondary {
  height: 36px;
  padding: 0 14px;
  background: var(--paper-white);
  color: var(--ink);
  border: 1px solid var(--yangli-graphite);
  border-radius: var(--radius-2);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.tt-btn-secondary:hover:not(:disabled) {
  background: var(--ink);
  color: var(--paper-white);
  border-color: var(--ink);
}
.tt-btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ============ 立即打印 primary（唯一红色填充 CTA） ============ */
.tt-btn-primary {
  height: 36px;
  padding: 0 14px;
  background: var(--yangli-red);
  color: var(--paper-white);
  border: 1px solid var(--yangli-red);
  border-radius: var(--radius-2);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.tt-btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.tt-btn-primary:active {
  background: var(--accent-press);
  border-color: var(--accent-press);
  transform: translateY(1px);
}
</style>
