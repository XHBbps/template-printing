<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import type { TemplateElement } from '@template-printing/schema';
import BarcodeContentPicker from './BarcodeContentPicker.vue';
import SliderWithInput from './SliderWithInput.vue';

const props = defineProps<{ element: Extract<TemplateElement, { type: 'barcode' }> }>();
const emit = defineEmits<{ (e: 'update', patch: Partial<TemplateElement>): void }>();

function update(patch: Record<string, unknown>): void {
  emit('update', patch as Partial<TemplateElement>);
}
</script>

<template>
  <div class="bc-block">
    <div class="bc-title">条码控制</div>

    <BarcodeContentPicker
      :element="props.element"
      @update="(p: Partial<TemplateElement>) => emit('update', p)"
    />

    <div class="srow">
      <span class="slbl">类型</span>
      <select
        class="ssel"
        :value="props.element.symbology"
        @change="(e: Event) => update({ symbology: (e.target as HTMLSelectElement).value })"
      >
        <option value="code128">Code 128</option>
        <option value="code39">Code 39</option>
        <option value="ean13">EAN-13</option>
        <option value="itf14">ITF-14</option>
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
        :model-value="props.element.quietZone ?? 4"
        :min="0"
        :max="8"
        :step="1"
        @update:model-value="(v: number) => update({ quietZone: v })"
      />
    </div>

    <div class="srow">
      <span class="slbl">显示文字</span>
      <input
        type="checkbox"
        :checked="props.element.showText"
        @change="(e: Event) => update({ showText: (e.target as HTMLInputElement).checked })"
      />
    </div>
    <div v-if="props.element.showText" class="srow">
      <span class="slbl">文字位置</span>
      <div class="seg">
        <button
          :class="{ on: (props.element.textPosition ?? 'bottom') === 'top' }"
          @click="update({ textPosition: 'top' })"
        >
          上
        </button>
        <button
          :class="{ on: (props.element.textPosition ?? 'bottom') === 'bottom' }"
          @click="update({ textPosition: 'bottom' })"
        >
          下
        </button>
      </div>
    </div>
    <div v-if="props.element.showText" class="srow">
      <span class="slbl">文字字号</span>
      <input
        type="number"
        min="6"
        max="32"
        step="1"
        :value="props.element.textFontSize ?? 10"
        class="snum"
        @input="
          (e: Event) => update({ textFontSize: Number((e.target as HTMLInputElement).value) })
        "
      />
      <span class="sval">px</span>
    </div>
  </div>
</template>

<style scoped>
.bc-block {
  padding: 12px 14px;
  border-bottom: 1px solid var(--tp-line);
}
.bc-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--tp-ink-soft);
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
  color: var(--tp-ink-soft);
}
.sval {
  font-size: 11px;
  color: var(--tp-ink-soft);
  min-width: 40px;
  text-align: right;
}
.mono {
  font-family: ui-monospace, monospace;
}
.snum,
.ssel {
  padding: 3px 6px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 4px;
  font-size: 12px;
  min-width: 100px;
}
.seg {
  display: inline-flex;
  gap: 4px;
}
.seg button {
  border: 1px solid var(--tp-line-strong);
  background: var(--tp-panel);
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--tp-ink-soft);
}
.seg button.on {
  background: var(--tp-accent);
  color: #fff;
  border-color: var(--tp-accent);
}
</style>
