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
const isNearTop = computed(() => props.element.anchor.y < 8);

const canFitInside = computed(() => props.element.anchor.w >= 10 && props.element.anchor.h >= 8);

const gripMode = computed<'inside' | 'outside-above' | 'outside-below'>(() => {
  if (canFitInside.value) return 'inside';
  if (isNearTop.value) return 'outside-below';
  return 'outside-above';
});

const PX_PER_MM = 4;
const positionStyle = computed(() => {
  const z = store.view.zoom;
  return {
    left: `${props.element.anchor.x * PX_PER_MM * z}px`,
    top: `${props.element.anchor.y * PX_PER_MM * z}px`,
    width: `${props.element.anchor.w * PX_PER_MM * z}px`,
    height: `${props.element.anchor.h * PX_PER_MM * z}px`,
    zIndex: props.element.style.zIndex ?? 0,
  };
});

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
    <ElementGrip v-if="isSelected" :mode="gripMode" @pointerdown="onGripDown" />
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
  box-shadow:
    inset 0 0 0 2px var(--tp-accent),
    0 0 16px rgba(108, 92, 231, 0.18);
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
