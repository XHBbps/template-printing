<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle } from '@template-printing/schema';

const props = defineProps<{ modelValue: ElementStyle['border'] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ElementStyle['border']): void }>();

function toggle(side: 'top' | 'right' | 'bottom' | 'left'): void {
  emit('update:modelValue', {
    ...props.modelValue,
    [side]: { ...props.modelValue[side], show: !props.modelValue[side].show },
  });
}
</script>

<template>
  <div class="bp-block">
    <div class="bp-title">边框 <span class="hint">点方向切换显隐</span></div>
    <div class="grid">
      <button class="cell t" :class="{ on: props.modelValue.top.show }" @click="toggle('top')">
        上
      </button>
      <button class="cell l" :class="{ on: props.modelValue.left.show }" @click="toggle('left')">
        左
      </button>
      <div class="center">elem</div>
      <button class="cell r" :class="{ on: props.modelValue.right.show }" @click="toggle('right')">
        右
      </button>
      <button
        class="cell b"
        :class="{ on: props.modelValue.bottom.show }"
        @click="toggle('bottom')"
      >
        下
      </button>
    </div>
  </div>
</template>

<style scoped>
.bp-block {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
}
.bp-title {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
}
.hint {
  color: var(--el-text-color-placeholder);
  font-weight: normal;
  font-size: 10.5px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 60px 1fr;
  grid-template-rows: 28px 1fr 28px;
  height: 96px;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
  padding: 4px;
  gap: 2px;
}
.cell {
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--el-text-color-secondary);
}
.cell:hover {
  background: var(--el-fill-color-light);
}
.cell.on {
  color: var(--tp-accent-ink);
  background: var(--tp-accent-bg);
  font-weight: 600;
}
.cell.t {
  grid-area: 1 / 1 / 2 / 4;
}
.cell.b {
  grid-area: 3 / 1 / 4 / 4;
}
.cell.l {
  grid-area: 2 / 1 / 3 / 2;
}
.cell.r {
  grid-area: 2 / 3 / 3 / 4;
}
.center {
  grid-area: 2 / 2 / 3 / 3;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}
</style>
