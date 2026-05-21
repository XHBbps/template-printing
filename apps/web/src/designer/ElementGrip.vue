<script setup lang="ts">
defineEmits<{
  (e: 'pointerdown', ev: PointerEvent): void;
}>();
</script>

<template>
  <div class="grip" @pointerdown.stop="$emit('pointerdown', $event)">
    <span class="dots"><i /><i /><i /><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.grip {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  border: 1.5px solid #0969da;
  border-radius: 6px;
  width: 28px;
  height: 18px;
  cursor: grab;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(31, 35, 40, 0.08);
}
.grip:hover {
  background: #ddf4ff;
}
.grip:active {
  cursor: grabbing;
}
.dots {
  display: grid;
  grid-template-columns: repeat(3, 3px);
  grid-template-rows: repeat(2, 3px);
  gap: 2px;
}
.dots i {
  background: #0969da;
  border-radius: 50%;
  width: 3px;
  height: 3px;
}
</style>
