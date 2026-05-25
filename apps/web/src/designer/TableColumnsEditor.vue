<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElInput, ElOption, ElSelect } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-vue-next';

interface ColumnLike {
  key: string;
  header: string;
  cs: number;
  align: 'left' | 'center' | 'right';
  format: string | null;
}

const props = defineProps<{ columns: ColumnLike[] }>();
const emit = defineEmits<{ (e: 'update', cols: ColumnLike[]): void }>();

function patchAt(i: number, patch: Partial<ColumnLike>): void {
  const next = props.columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
  emit('update', next);
}

function removeAt(i: number): void {
  emit(
    'update',
    props.columns.filter((_, idx) => idx !== i),
  );
}

function moveUp(i: number): void {
  if (i === 0) return;
  const next = [...props.columns];
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  emit('update', next);
}

function moveDown(i: number): void {
  if (i === props.columns.length - 1) return;
  const next = [...props.columns];
  [next[i], next[i + 1]] = [next[i + 1], next[i]];
  emit('update', next);
}

function addColumn(): void {
  const idx = props.columns.length + 1;
  emit('update', [
    ...props.columns,
    { key: `col${idx}`, header: `列${idx}`, cs: 30, align: 'left', format: null },
  ]);
}
</script>

<template>
  <div class="tc-block">
    <div class="tc-title">列管理</div>

    <div class="tc-list">
      <div v-for="(col, i) in props.columns" :key="i" class="tc-row">
        <ElInput
          :model-value="col.key"
          size="small"
          placeholder="key"
          style="width: 70px"
          @update:model-value="(v: string) => patchAt(i, { key: v })"
        />
        <ElInput
          :model-value="col.header"
          size="small"
          placeholder="表头"
          style="width: 80px"
          @update:model-value="(v: string) => patchAt(i, { header: v })"
        />
        <ElInput
          :model-value="String(col.cs)"
          size="small"
          placeholder="宽度"
          style="width: 50px"
          @update:model-value="(v: string) => patchAt(i, { cs: Math.max(1, parseInt(v, 10) || 1) })"
        />
        <ElSelect
          :model-value="col.align"
          size="small"
          style="width: 64px"
          @change="(v: 'left' | 'center' | 'right') => patchAt(i, { align: v })"
        >
          <ElOption value="left" label="左" />
          <ElOption value="center" label="中" />
          <ElOption value="right" label="右" />
        </ElSelect>
        <div class="tc-actions">
          <button class="tc-mv" @click="moveUp(i)" :disabled="i === 0" title="上移">
            <ChevronUp :size="13" :stroke-width="2" />
          </button>
          <button
            class="tc-mv"
            @click="moveDown(i)"
            :disabled="i === props.columns.length - 1"
            title="下移"
          >
            <ChevronDown :size="13" :stroke-width="2" />
          </button>
          <button class="tc-del" @click="removeAt(i)" title="删除">
            <Trash2 :size="13" :stroke-width="2" />
          </button>
        </div>
      </div>
    </div>

    <ElButton link style="margin-top: 8px" @click="addColumn">
      <Plus :size="14" :stroke-width="2" style="margin-right: 4px" />
      添加列
    </ElButton>
  </div>
</template>

<style scoped>
.tc-block {
  padding: 12px 14px;
  border-bottom: 1px solid var(--stone);
}
.tc-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--yangli-graphite);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.tc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tc-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tc-actions {
  display: inline-flex;
  gap: 2px;
}
.tc-actions button {
  border: none;
  background: transparent;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--iron);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tc-actions button:hover {
  background: rgba(211, 45, 39, 0.04);
  color: var(--yangli-red);
}
.tc-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tc-actions .tc-del:hover {
  background: rgba(217, 79, 79, 0.1);
  color: var(--yangli-red);
}
</style>
