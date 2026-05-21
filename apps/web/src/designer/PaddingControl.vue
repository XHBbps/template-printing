<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle } from '@template-printing/schema';

const props = defineProps<{ modelValue: ElementStyle['padding'] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ElementStyle['padding']): void }>();

function setSide(side: 't' | 'r' | 'b' | 'l', n: number): void {
  emit('update:modelValue', { ...props.modelValue, [side]: Math.max(0, n) });
}
</script>

<template>
  <div class="pad-block">
    <div class="pad-title">内边距 <span class="hint">px</span></div>
    <div class="grid">
      <label
        >上
        <input
          type="number"
          :value="props.modelValue.t"
          min="0"
          @input="setSide('t', Number(($event.target as HTMLInputElement).value))"
      /></label>
      <label
        >右
        <input
          type="number"
          :value="props.modelValue.r"
          min="0"
          @input="setSide('r', Number(($event.target as HTMLInputElement).value))"
      /></label>
      <label
        >下
        <input
          type="number"
          :value="props.modelValue.b"
          min="0"
          @input="setSide('b', Number(($event.target as HTMLInputElement).value))"
      /></label>
      <label
        >左
        <input
          type="number"
          :value="props.modelValue.l"
          min="0"
          @input="setSide('l', Number(($event.target as HTMLInputElement).value))"
      /></label>
    </div>
  </div>
</template>

<style scoped>
.pad-block {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
}
.pad-title {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
}
.hint {
  color: var(--el-text-color-placeholder);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font: inherit;
  font-size: 11px;
  text-align: right;
}
</style>
