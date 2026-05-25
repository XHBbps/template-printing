<script setup lang="ts">
import { nextTick, ref } from 'vue';

const props = defineProps<{
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>();

const editing = ref(false);
const draft = ref('');
const numRef = ref<HTMLInputElement | null>(null);

function onSlide(e: Event): void {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value));
}

function startEdit(): void {
  draft.value = String(props.modelValue);
  editing.value = true;
  void nextTick(() => {
    numRef.value?.focus();
    numRef.value?.select();
  });
}

function commitEdit(): void {
  const v = Number(draft.value);
  if (Number.isFinite(v)) {
    const clamped = Math.max(props.min, Math.min(props.max, v));
    emit('update:modelValue', clamped);
  }
  editing.value = false;
}

function cancelEdit(): void {
  editing.value = false;
}

function display(v: number): string {
  return props.format ? props.format(v) : String(v);
}
</script>

<template>
  <div class="swi">
    <input
      type="range"
      class="swi-range"
      :min="props.min"
      :max="props.max"
      :step="props.step ?? 1"
      :value="props.modelValue"
      @input="onSlide"
    />
    <span v-if="!editing" class="swi-val" @dblclick="startEdit" title="双击编辑数值">{{
      display(props.modelValue)
    }}</span>
    <input
      v-else
      ref="numRef"
      v-model="draft"
      type="number"
      class="swi-num"
      :min="props.min"
      :max="props.max"
      :step="props.step ?? 1"
      @blur="commitEdit"
      @keydown.enter="commitEdit"
      @keydown.escape="cancelEdit"
    />
  </div>
</template>

<style scoped>
.swi {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.swi-range {
  flex: 1;
  accent-color: var(--yangli-red);
  height: 4px;
  cursor: pointer;
}
.swi-val {
  min-width: 40px;
  text-align: right;
  font-size: 11px;
  color: var(--yangli-graphite);
  font-family: ui-monospace, monospace;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
  transition: background 120ms ease;
}
.swi-val:hover {
  background: rgba(211, 45, 39, 0.04);
}
.swi-num {
  width: 56px;
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid var(--yangli-red);
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  text-align: right;
  background: var(--paper-white);
  outline: none;
}
.swi-num::-webkit-outer-spin-button,
.swi-num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
