<script setup lang="ts">
defineEmits<{
  (e: 'pointerdown', ev: PointerEvent): void;
}>();
</script>

<template>
  <div class="tp-grip" @pointerdown.stop="$emit('pointerdown', $event)">
    <span class="tp-grip-dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.tp-grip {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--tp-panel);
  border: 1.5px solid var(--tp-accent);
  border-radius: 8px;
  width: 32px;
  height: 20px;
  cursor: grab;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--tp-accent-shadow);
}
.tp-grip:hover {
  background: var(--tp-accent-bg);
}
.tp-grip:active {
  cursor: grabbing;
}
.tp-grip-dots {
  display: grid;
  grid-template-columns: repeat(3, 3px);
  grid-template-rows: repeat(2, 3px);
  gap: 2.5px;
}
.tp-grip-dots i {
  background: var(--tp-accent);
  border-radius: 50%;
  width: 3px;
  height: 3px;
  display: block;
}
</style>
