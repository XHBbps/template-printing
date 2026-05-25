<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle } from '@template-printing/schema';
import SliderWithInput from './SliderWithInput.vue';

const props = defineProps<{ modelValue: ElementStyle['border'] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ElementStyle['border']): void }>();

type Side = 'top' | 'right' | 'bottom' | 'left';

function toggle(side: Side): void {
  emit('update:modelValue', {
    ...props.modelValue,
    [side]: { ...props.modelValue[side], show: !props.modelValue[side].show },
  });
}

function patchAllSides(
  patch: Partial<{ style: 'solid' | 'dashed' | 'dotted'; width: number; color: string }>,
): void {
  const next = { ...props.modelValue };
  (['top', 'right', 'bottom', 'left'] as Side[]).forEach((s) => {
    next[s] = { ...next[s], ...patch };
  });
  emit('update:modelValue', next);
}

function currentStyle(): 'solid' | 'dashed' | 'dotted' {
  return props.modelValue.top.style;
}
function currentWidth(): number {
  return props.modelValue.top.width;
}
function currentColor(): string {
  return props.modelValue.top.color;
}
</script>

<template>
  <div class="bp-block">
    <div class="bp-title">边框</div>

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

    <div class="bp-controls">
      <div class="ctrl-row">
        <span class="ctrl-lbl">线型</span>
        <div class="seg">
          <button
            :class="{ on: currentStyle() === 'solid' }"
            @click="patchAllSides({ style: 'solid' })"
          >
            —
          </button>
          <button
            :class="{ on: currentStyle() === 'dashed' }"
            @click="patchAllSides({ style: 'dashed' })"
          >
            - -
          </button>
          <button
            :class="{ on: currentStyle() === 'dotted' }"
            @click="patchAllSides({ style: 'dotted' })"
          >
            • •
          </button>
        </div>
      </div>
      <div class="ctrl-row">
        <span class="ctrl-lbl">粗细</span>
        <SliderWithInput
          :model-value="currentWidth()"
          :min="1"
          :max="8"
          :step="1"
          :format="(v: number) => `${v} px`"
          @update:model-value="(v: number) => patchAllSides({ width: v })"
        />
      </div>
      <div class="ctrl-row">
        <span class="ctrl-lbl">颜色</span>
        <input
          type="color"
          :value="currentColor()"
          class="color-pick"
          @input="(e: Event) => patchAllSides({ color: (e.target as HTMLInputElement).value })"
        />
        <span class="ctrl-val mono">{{ currentColor() }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bp-block {
  padding: 12px 14px;
  border-bottom: 1px solid var(--stone);
}
.bp-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--yangli-graphite);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 60px 1fr;
  grid-template-rows: 28px 1fr 28px;
  height: 96px;
  border: 1px dashed var(--yangli-graphite);
  border-radius: 6px;
  padding: 4px;
  gap: 2px;
}
.cell {
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  font-size: 11px;
  color: var(--yangli-graphite);
}
.cell:hover {
  background: rgba(211, 45, 39, 0.04);
}
.cell.on {
  color: var(--yangli-red);
  background: rgba(211, 45, 39, 0.08);
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
  border: 1px solid var(--yangli-graphite);
  background: rgba(211, 45, 39, 0.04);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--iron);
}

.bp-controls {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ctrl-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ctrl-lbl {
  width: 36px;
  font-size: 11px;
  color: var(--yangli-graphite);
}
.ctrl-val {
  font-size: 11px;
  color: var(--yangli-graphite);
  min-width: 40px;
  text-align: right;
}
.mono {
  font-family: ui-monospace, monospace;
}
.seg {
  display: inline-flex;
  gap: 4px;
}
.seg button {
  border: 1px solid var(--yangli-graphite);
  background: var(--paper-white);
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--yangli-graphite);
}
.seg button.on {
  background: var(--yangli-red);
  color: #fff;
  border-color: var(--yangli-red);
}
.color-pick {
  width: 32px;
  height: 22px;
  border: 1px solid var(--yangli-graphite);
  border-radius: 4px;
  padding: 0;
  cursor: pointer;
}
</style>
