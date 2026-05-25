<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { Undo2, Redo2, Hand, Minus, Plus } from 'lucide-vue-next';
import { computed, nextTick, ref } from 'vue';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

const zoomLabel = computed(() => `${Math.round(store.view.zoom * 100)}%`);

// Double-click on zoom label → editable input
const editing = ref(false);
const inputValue = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

async function startEdit(): Promise<void> {
  editing.value = true;
  inputValue.value = String(Math.round(store.view.zoom * 100));
  await nextTick();
  inputRef.value?.select();
}

function commitEdit(): void {
  const v = Number(inputValue.value);
  if (Number.isFinite(v) && v >= 25 && v <= 400) {
    store.setZoom(v / 100);
  }
  editing.value = false;
}

function cancelEdit(): void {
  // Reset inputValue to the current zoom first, so the blur-triggered
  // commitEdit (fired when v-if removes the input) is a no-op rather than
  // applying the (rejected) typed value.
  inputValue.value = String(Math.round(store.view.zoom * 100));
  editing.value = false;
}
</script>

<template>
  <div class="cft-bar">
    <button class="cft-btn" :disabled="!store.canUndo" title="撤销 (⌘Z)" @click="store.undo">
      <Undo2 :size="16" :stroke-width="2" />
    </button>
    <button class="cft-btn" :disabled="!store.canRedo" title="重做 (⌘⇧Z)" @click="store.redo">
      <Redo2 :size="16" :stroke-width="2" />
    </button>

    <span class="cft-divider" />

    <button
      class="cft-btn cft-btn--toggle"
      :class="{ 'cft-btn--active': store.panMode }"
      title="拖动画布模式 (H)"
      @click="store.togglePanMode"
    >
      <Hand :size="16" :stroke-width="2" />
    </button>

    <span class="cft-divider" />

    <button class="cft-btn" title="缩小" @click="store.zoomOut">
      <Minus :size="16" :stroke-width="2" />
    </button>
    <span v-if="!editing" class="cft-zoom-label" title="点击输入比例" @click="startEdit">
      {{ zoomLabel }}
    </span>
    <input
      v-else
      ref="inputRef"
      v-model="inputValue"
      type="number"
      min="25"
      max="400"
      step="1"
      class="cft-zoom-input"
      @blur="commitEdit"
      @keydown.enter="commitEdit"
      @keydown.esc="cancelEdit"
    />
    <button class="cft-btn" title="放大" @click="store.zoomIn">
      <Plus :size="16" :stroke-width="2" />
    </button>
  </div>
</template>

<style scoped>
.cft-bar {
  position: absolute;
  bottom: 24px;
  right: 24px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  padding: 4px;
  user-select: none;
}
.cft-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
}
.cft-btn:hover:not(:disabled) {
  background: var(--mist);
  color: var(--ink);
}
.cft-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cft-btn--active {
  background: var(--ink);
  color: var(--paper-white);
}
.cft-btn--active:hover {
  background: var(--ink);
  color: var(--paper-white);
}
.cft-divider {
  width: 1px;
  height: 16px;
  background: var(--stone);
  margin: 0 4px;
}
.cft-zoom-label {
  min-width: 44px;
  height: 28px;
  text-align: center;
  font-size: 11.5px;
  color: var(--ink);
  font-family: var(--font-mono);
  cursor: pointer;
  padding: 0 6px;
  border-radius: var(--radius-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-fast) var(--ease-default);
}
.cft-zoom-label:hover {
  background: var(--mist);
}
.cft-zoom-input {
  width: 56px;
  height: 28px;
  text-align: center;
  font-size: 11.5px;
  font-family: var(--font-mono);
  padding: 0 6px;
  border-radius: var(--radius-1);
  border: 1px solid var(--yangli-red);
  outline: none;
  color: var(--ink);
  background: var(--paper-white);
}
/* Hide number input spinners */
.cft-zoom-input::-webkit-outer-spin-button,
.cft-zoom-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.cft-zoom-input[type='number'] {
  -moz-appearance: textfield;
}
</style>
