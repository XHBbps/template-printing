<script setup lang="ts">
import { nextTick, ref } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Check, Copy, Pencil } from 'lucide-vue-next';
import { ElMessage } from 'element-plus';
import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();
const editing = ref(false);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function startEdit(): void {
  draft.value = store.template.meta.name;
  editing.value = true;
  void nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

function commit(): void {
  const v = draft.value.trim();
  if (v && v !== store.template.meta.name) {
    store.setName(v);
  }
  editing.value = false;
}

function cancel(): void {
  editing.value = false;
}

// --- 模板 ID 复制 ---
const copied = ref(false);
async function copyId(e: MouseEvent): Promise<void> {
  e.stopPropagation(); // 不要触发 startEdit
  const id = store.templateId;
  if (!id) {
    ElMessage.warning('模板尚未保存，无 ID');
    return;
  }
  try {
    await navigator.clipboard.writeText(id);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    ElMessage.error('复制失败');
  }
}
</script>

<template>
  <div v-if="!editing" class="tne-display" @click="startEdit">
    <span class="tne-title">{{ store.template.meta.name }}</span>
    <Pencil :size="12" :stroke-width="2" class="tne-edit-hint" />
    <button
      v-if="store.templateId"
      class="tne-copy-btn"
      :title="copied ? '已复制' : '复制模板ID'"
      @click="copyId"
    >
      <Check v-if="copied" :size="12" :stroke-width="2.5" class="tne-copy-icon tne-copy-ok" />
      <Copy v-else :size="12" :stroke-width="2" class="tne-copy-icon" />
    </button>
  </div>
  <input
    v-else
    ref="inputRef"
    v-model="draft"
    class="tne-input"
    @blur="commit"
    @keydown.enter="commit"
    @keydown.escape="cancel"
  />
</template>

<style scoped>
.tne-display {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 4px;
  transition: background 120ms ease;
}
.tne-display:hover {
  background: var(--tp-field-bg);
}
.tne-title {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tne-edit-hint {
  color: var(--tp-ink-faint);
  opacity: 0;
  transition: opacity 120ms ease;
}
.tne-display:hover .tne-edit-hint {
  opacity: 1;
}
.tne-copy-btn {
  border: none;
  background: transparent;
  padding: 2px;
  margin-left: 2px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-faint);
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease,
    color 120ms ease;
}
.tne-display:hover .tne-copy-btn {
  opacity: 1;
}
.tne-copy-btn:hover {
  background: var(--tp-field-bg);
  color: var(--tp-accent);
}
.tne-copy-ok {
  color: #16a34a;
}
.tne-input {
  width: 100%;
  font: inherit;
  font-weight: 700;
  font-size: 14px;
  padding: 2px 4px;
  border: 1px solid var(--tp-accent);
  border-radius: 4px;
  background: var(--tp-panel);
  outline: none;
  color: var(--tp-ink);
}
</style>
