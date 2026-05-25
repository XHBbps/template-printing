<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import BarcodeContentPicker from './BarcodeContentPicker.vue';
import SliderWithInput from './SliderWithInput.vue';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'qr' }> }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

function update(patch: Record<string, unknown>): void {
  emit('update', patch as Partial<TemplateElement>);
}
</script>

<template>
  <div class="qr-block">
    <div class="qr-title">二维码控制</div>

    <BarcodeContentPicker
      :element="props.element"
      @update="(p: Partial<TemplateElement>) => emit('update', p)"
    />

    <div class="srow">
      <span class="slbl">容错</span>
      <select
        class="ssel"
        :value="props.element.eccLevel ?? 'M'"
        @change="(e: Event) => update({ eccLevel: (e.target as HTMLSelectElement).value })"
      >
        <option value="L">L · 7%</option>
        <option value="M">M · 15%</option>
        <option value="Q">Q · 25%</option>
        <option value="H">H · 30%</option>
      </select>
    </div>
    <div class="srow">
      <span class="slbl">前景</span>
      <input
        type="color"
        :value="props.element.foregroundColor ?? '#000000'"
        @input="(e: Event) => update({ foregroundColor: (e.target as HTMLInputElement).value })"
      />
      <span class="sval mono">{{ props.element.foregroundColor ?? '#000000' }}</span>
    </div>
    <div class="srow">
      <span class="slbl">背景</span>
      <input
        type="color"
        :value="props.element.backgroundColor ?? '#ffffff'"
        @input="(e: Event) => update({ backgroundColor: (e.target as HTMLInputElement).value })"
      />
      <span class="sval mono">{{ props.element.backgroundColor ?? '#ffffff' }}</span>
    </div>
    <div class="srow">
      <span class="slbl">静区</span>
      <SliderWithInput
        :model-value="props.element.quietZone ?? 2"
        :min="0"
        :max="8"
        :step="1"
        @update:model-value="(v: number) => update({ quietZone: v })"
      />
    </div>
  </div>
</template>

<style scoped>
.qr-block {
  padding: 12px 14px;
  border-bottom: 1px solid var(--stone);
}
.qr-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--yangli-graphite);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
.srow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.slbl {
  width: 56px;
  font-size: 11px;
  color: var(--yangli-graphite);
}
.sval {
  font-size: 11px;
  color: var(--yangli-graphite);
  min-width: 40px;
  text-align: right;
}
.mono {
  font-family: ui-monospace, monospace;
}
.ssel {
  padding: 3px 6px;
  border: 1px solid var(--yangli-graphite);
  border-radius: 4px;
  font-size: 12px;
  min-width: 100px;
}
</style>
