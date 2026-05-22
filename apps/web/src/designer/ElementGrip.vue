<script setup lang="ts">
defineProps<{ isSmall?: boolean }>();
defineEmits<{ (e: 'pointerdown', ev: PointerEvent): void }>();
</script>

<template>
  <div
    class="tp-grip"
    :class="{ 'tp-grip--outside': isSmall }"
    @pointerdown.stop="$emit('pointerdown', $event)"
  >
    <span class="tp-grip-dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.tp-grip {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  cursor: grab;
  z-index: 4;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: background 120ms ease;
}
.tp-grip:hover {
  background: rgba(108, 92, 231, 0.12);
}
.tp-grip:active {
  cursor: grabbing;
}

.tp-grip--outside {
  top: -28px;
  background: var(--tp-panel);
  border: 1.5px solid var(--tp-accent);
  border-radius: 8px;
  width: 32px;
  height: 20px;
  box-shadow: var(--tp-accent-shadow);
  padding: 0;
}
.tp-grip--outside:hover {
  background: var(--tp-accent-bg);
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
