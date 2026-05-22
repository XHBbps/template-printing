<script setup lang="ts">
import { computed, ref } from 'vue';
// eslint-disable-next-line import/no-unresolved
import {
  TextElement,
  FieldElement,
  ImageElement,
  TableElement,
  BarcodeElement,
  QrElement,
  AutonumberElement,
  SystemElement,
  RectElement,
} from '@template-printing/template-renderer';
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';
import ElementGrip from './ElementGrip.vue';
import HitZones from './HitZones.vue';
import { usePointerDrag } from './usePointerDrag';

const props = defineProps<{ element: TemplateElement }>();
const store = useDesignerStore();

const elRef = ref<HTMLElement | null>(null);
const isSelected = computed(() => store.selectedIds.includes(props.element.id));
const isNearTop = computed(() => {
  // anchor.y in mm; 8 mm safely fits the outside pill (28 px ≈ 7 mm) + margin.
  return props.element.anchor.y < 8;
});

const useInsideGrip = computed(() => {
  // Use inside grip when element is too short, too narrow, OR too close to top.
  if (props.element.grid.rs < 6) return true;
  if (props.element.grid.cs < 8) return true;
  if (isNearTop.value) return true;
  return false;
});

const PX_PER_MM = 4;
const positionStyle = computed(() => ({
  left: `${props.element.anchor.x * PX_PER_MM}px`,
  top: `${props.element.anchor.y * PX_PER_MM}px`,
  width: `${props.element.anchor.w * PX_PER_MM}px`,
  height: `${props.element.anchor.h * PX_PER_MM}px`,
}));

const sizeBadge = computed(() => {
  const g = props.element.grid;
  if (props.element.type === 'qr') {
    return `${g.cs}×${g.rs} 格 (1:1)`;
  }
  return `${g.cs}×${g.rs} 格`;
});

function selectMe(e: MouseEvent): void {
  e.stopPropagation();
  store.select([props.element.id]);
}

const { onGripDown, onResizeDown } = usePointerDrag(props.element.id, () => elRef.value);

const elementMap: Record<string, unknown> = {
  text: TextElement,
  field: FieldElement,
  image: ImageElement,
  table: TableElement,
  barcode: BarcodeElement,
  qr: QrElement,
  autonumber: AutonumberElement,
  system: SystemElement,
  rect: RectElement,
};
</script>

<template>
  <div
    ref="elRef"
    class="tp-element"
    :class="{ 'is-selected': isSelected }"
    :style="positionStyle"
    @click="selectMe"
  >
    <component
      :is="elementMap[props.element.type]"
      :element="props.element"
      :is-resizing="store.isResizing && isSelected"
      design-mode
    />
    <ElementGrip v-if="isSelected" :is-small="!useInsideGrip" @pointerdown="onGripDown" />
    <HitZones
      v-if="isSelected"
      :mode="props.element.type === 'qr' ? 'qr' : 'free'"
      @pointerdown="onResizeDown"
    />
    <span v-if="isSelected" class="tp-handle tp-handle-tl" />
    <span v-if="isSelected" class="tp-handle tp-handle-tr" />
    <span v-if="isSelected" class="tp-handle tp-handle-bl" />
    <span v-if="isSelected" class="tp-handle tp-handle-br" />
    <span v-if="isSelected" class="tp-size-badge">{{ sizeBadge }}</span>
  </div>
</template>

<style scoped>
.tp-element {
  position: absolute;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
}
.tp-element.is-selected {
  outline: 1.5px solid var(--tp-accent);
  outline-offset: 3px;
  box-shadow: 0 0 24px rgba(108, 92, 231, 0.18);
}
/* 4 corner handles — white fill, purple border, circular (#3) */
.tp-handle {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #fff;
  border: 1.5px solid var(--tp-accent);
  border-radius: 50%;
  z-index: 4;
  pointer-events: none;
}
.tp-handle-tl {
  top: -5px;
  left: -5px;
}
.tp-handle-tr {
  top: -5px;
  right: -5px;
}
.tp-handle-bl {
  bottom: -5px;
  left: -5px;
}
.tp-handle-br {
  bottom: -5px;
  right: -5px;
}
/* Bottom-right size badge */
.tp-size-badge {
  position: absolute;
  bottom: -26px;
  right: -1px;
  background: var(--tp-ink);
  color: #fff;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 5px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
  pointer-events: none;
  z-index: 4;
}
</style>
