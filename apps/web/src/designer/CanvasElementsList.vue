<script setup lang="ts">
import { computed, ref, watch } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
// eslint-disable-next-line import/no-unresolved
import { ElMessageBox } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import {
  Type,
  Braces,
  Hash,
  Clock,
  Square,
  Image,
  Table,
  QrCode,
  Barcode,
  X,
  Trash2,
} from 'lucide-vue-next';
import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const PAGE_SIZE = 10;
const page = ref(1);

const elements = computed(() => store.template.elements);
const pageCount = computed(() => Math.max(1, Math.ceil(elements.value.length / PAGE_SIZE)));
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return elements.value.slice(start, start + PAGE_SIZE);
});

watch(pageCount, (n) => {
  if (page.value > n) page.value = n;
});

watch(
  () => store.selectedIds,
  (ids) => {
    if (ids.length !== 1) return;
    const idx = elements.value.findIndex((el) => el.id === ids[0]);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (targetPage !== page.value) page.value = targetPage;
  },
);

function summarize(el: TemplateElement): string {
  switch (el.type) {
    case 'text':
      return `text · ${el.content.static.slice(0, 16) || '空'}`;
    case 'field':
      return `field · ${el.binding || '（未绑定）'}`;
    case 'image':
      return `image`;
    case 'rect':
      return `rect`;
    case 'table':
      return `table · ${el.binding}`;
    case 'qr':
      return `qr · ${el.content?.static ?? el.binding ?? '空'}`;
    case 'barcode':
      return `${el.symbology} · ${el.content?.static ?? el.binding ?? '空'}`;
    case 'autonumber':
      return `№ · ${el.sequence}`;
    case 'system':
      return `system · ${el.variable}`;
  }
}

const iconFor: Record<TemplateElement['type'], unknown> = {
  text: Type,
  field: Braces,
  autonumber: Hash,
  system: Clock,
  rect: Square,
  image: Image,
  table: Table,
  qr: QrCode,
  barcode: Barcode,
};

function selectOne(id: string): void {
  store.select([id]);
}
function removeEl(id: string, e: Event): void {
  e.stopPropagation();
  store.deleteElement(id);
}
async function onClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定清空全部 ${elements.value.length} 个元素？此操作可通过撤销恢复。`,
      '清空画布',
      {
        confirmButtonText: '清空',
        cancelButtonText: '取消',
        type: 'warning',
        center: true,
      },
    );
    store.deleteAllElements();
  } catch {
    /* user cancelled */
  }
}
</script>

<template>
  <div class="canvas-elems-list">
    <div class="tp-sub-head">
      <span class="tp-sub-title">画布元素 · 共 {{ elements.length }} 个</span>
      <button v-if="elements.length > 0" class="clear-btn" @click="onClearAll" title="清空全部元素">
        <Trash2 :size="13" :stroke-width="2" />
        <span>清空</span>
      </button>
    </div>
    <div class="list-body">
      <div v-if="elements.length === 0" class="empty">从上方拖入或点击元素来开始设计</div>
      <div
        v-for="el in paged"
        :key="el.id"
        class="elem-row"
        :class="{ 'is-active': store.selectedIds.includes(el.id) }"
        @click="selectOne(el.id)"
      >
        <span class="elem-icon">
          <component :is="iconFor[el.type]" :size="14" :stroke-width="2" />
        </span>
        <span class="elem-label">{{ summarize(el) }}</span>
        <button class="elem-del" @click="(e: Event) => removeEl(el.id, e)" title="删除">
          <X :size="14" :stroke-width="2" />
        </button>
      </div>
    </div>
    <div v-if="pageCount > 1" class="pagination">
      <button :disabled="page <= 1" @click="page--">‹</button>
      <span class="pgno">{{ page }} / {{ pageCount }}</span>
      <button :disabled="page >= pageCount" @click="page++">›</button>
      <span class="pgsize">每页 {{ PAGE_SIZE }}</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-elems-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px 6px;
}
/* 空态 — 1px dashed stone 框 + iron 文字（brief §5.3） */
.empty {
  margin: 12px 12px;
  padding: 24px 16px;
  text-align: center;
  font-family: var(--font-han);
  font-size: 12px;
  line-height: 1.6;
  color: var(--iron);
  border: 1px dashed var(--stone);
  border-radius: var(--radius-2);
}

.clear-btn {
  background: transparent;
  border: none;
  font-family: var(--font-han);
  font-size: 11px;
  color: var(--fg-3);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition:
    color var(--dur-fast) var(--ease-default),
    background var(--dur-fast) var(--ease-default);
}
.clear-btn:hover {
  color: var(--yangli-red);
  background: rgba(211, 45, 39, 0.08);
}

.elem-row {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-2);
  cursor: pointer;
  color: var(--ink);
  font-size: 12.5px;
  margin-bottom: 2px;
  background: transparent;
}
.elem-row:hover {
  background: rgba(211, 45, 39, 0.04);
}
.elem-row.is-active {
  background: rgba(211, 45, 39, 0.08);
  color: var(--yangli-red);
  font-weight: 600;
}
.elem-row.is-active .elem-icon {
  background: var(--yangli-red);
  color: #fff;
}
.elem-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: rgba(211, 45, 39, 0.04);
  color: var(--yangli-red);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.elem-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.elem-del {
  border: none;
  background: transparent;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--iron);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease;
}
.elem-row:hover .elem-del {
  opacity: 1;
}
.elem-del:hover {
  background: rgba(217, 79, 79, 0.1);
  color: var(--yangli-red);
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 10px 10px;
  border-top: 1px solid var(--stone);
  font-size: 11px;
  color: var(--yangli-graphite);
}
.pagination button {
  width: 22px;
  height: 22px;
  border: 1px solid var(--yangli-graphite);
  background: var(--paper-white);
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink);
}
.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination .pgno {
  font-family: ui-monospace, monospace;
}
.pagination .pgsize {
  margin-left: auto;
  color: var(--iron);
}
</style>
