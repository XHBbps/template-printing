<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { Undo2, Redo2, Hand, Minus, Plus } from 'lucide-vue-next';
import { computed } from 'vue';

import { useDesignerStore } from '../stores/designer';

const store = useDesignerStore();

const zoomLabel = computed(() => `${Math.round(store.view.zoom * 100)}%`);
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
    <span class="cft-zoom-label" title="点击适配窗口" @click="store.fitView">
      {{ zoomLabel }}
    </span>
    <button class="cft-btn" title="放大" @click="store.zoomIn">
      <Plus :size="16" :stroke-width="2" />
    </button>
  </div>
</template>

<style scoped>
.cft-bar {
  position: absolute;
  bottom: 18px;
  right: 18px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  background: #fff;
  border-radius: 999px;
  padding: 4px 6px;
  box-shadow:
    0 2px 6px rgba(20, 20, 30, 0.06),
    0 8px 24px rgba(20, 20, 30, 0.1);
  border: 1px solid var(--tp-line, #ececef);
  user-select: none;
}
.cft-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--tp-ink-soft, #5e5e66);
  cursor: pointer;
  transition: all 120ms ease;
}
.cft-btn:hover:not(:disabled) {
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.06));
  color: var(--tp-accent, #6c5ce7);
}
.cft-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cft-btn--active {
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
}
.cft-btn--active:hover {
  background: var(--tp-accent, #6c5ce7);
  color: #fff;
}
.cft-divider {
  width: 1px;
  height: 18px;
  background: var(--tp-line, #ececef);
  margin: 0 4px;
}
.cft-zoom-label {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  color: var(--tp-ink, #1f1f23);
  font-family: ui-monospace, monospace;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 120ms ease;
}
.cft-zoom-label:hover {
  background: var(--tp-field-bg, rgba(108, 92, 231, 0.06));
}
</style>
