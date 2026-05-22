<script setup lang="ts">
const props = defineProps<{ mode?: 'free' | 'qr' }>();
defineEmits<{
  (
    e: 'pointerdown',
    side: 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se',
    ev: PointerEvent,
  ): void;
}>();
const showEdges = () => props.mode !== 'qr';
</script>

<template>
  <div class="hit-zones">
    <template v-if="showEdges()">
      <div class="hit n" @pointerdown.stop="$emit('pointerdown', 'n', $event)" />
      <div class="hit e" @pointerdown.stop="$emit('pointerdown', 'e', $event)" />
      <div class="hit s" @pointerdown.stop="$emit('pointerdown', 's', $event)" />
      <div class="hit w" @pointerdown.stop="$emit('pointerdown', 'w', $event)" />
    </template>
    <div class="hit corner nw" @pointerdown.stop="$emit('pointerdown', 'nw', $event)" />
    <div class="hit corner ne" @pointerdown.stop="$emit('pointerdown', 'ne', $event)" />
    <div class="hit corner sw" @pointerdown.stop="$emit('pointerdown', 'sw', $event)" />
    <div class="hit corner se" @pointerdown.stop="$emit('pointerdown', 'se', $event)" />
  </div>
</template>

<style scoped>
.hit-zones {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.hit {
  position: absolute;
  pointer-events: auto;
  z-index: 3;
}
.n {
  left: 12px;
  right: 12px;
  top: -4px;
  height: 12px;
  cursor: ns-resize;
}
.s {
  left: 12px;
  right: 12px;
  bottom: -4px;
  height: 12px;
  cursor: ns-resize;
}
.w {
  top: 8px;
  bottom: 8px;
  left: -4px;
  width: 12px;
  cursor: ew-resize;
}
.e {
  top: 8px;
  bottom: 8px;
  right: -4px;
  width: 12px;
  cursor: ew-resize;
}
.corner {
  width: 14px;
  height: 14px;
}
.nw {
  top: -4px;
  left: -4px;
  cursor: nwse-resize;
}
.ne {
  top: -4px;
  right: -4px;
  cursor: nesw-resize;
}
.sw {
  bottom: -4px;
  left: -4px;
  cursor: nesw-resize;
}
.se {
  bottom: -4px;
  right: -4px;
  cursor: nwse-resize;
}
</style>
