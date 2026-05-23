<script setup lang="ts">
defineProps<{ mode: 'inside' | 'outside-above' | 'outside-below' }>();
defineEmits<{ (e: 'pointerdown', ev: PointerEvent): void }>();
</script>

<template>
  <div
    class="tp-grip"
    :class="{
      'tp-grip--inside': mode === 'inside',
      'tp-grip--outside-above': mode === 'outside-above',
      'tp-grip--outside-below': mode === 'outside-below',
    }"
    @pointerdown.stop="$emit('pointerdown', $event)"
  >
    <span class="tp-grip-dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.tp-grip {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  cursor: grab;
  z-index: 4;
  width: 32px;
  height: 20px;
  background: var(--tp-panel);
  border: 1.5px solid var(--tp-accent);
  border-radius: 8px;
  box-shadow: var(--tp-accent-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease;
}
.tp-grip:hover {
  background: var(--tp-accent-bg);
}
.tp-grip:active {
  cursor: grabbing;
}
.tp-grip--inside {
  top: 4px;
}
.tp-grip--outside-above {
  top: -28px;
}
.tp-grip--outside-below {
  top: auto;
  bottom: -28px;
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
