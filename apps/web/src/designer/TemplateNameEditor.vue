<script setup lang="ts">
import { nextTick, ref } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Pencil } from 'lucide-vue-next';
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
</script>

<template>
  <div v-if="!editing" class="tne-display" @click="startEdit">
    <span class="tne-title">{{ store.template.meta.name }}</span>
    <Pencil :size="12" :stroke-width="2" class="tne-edit-hint" />
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
