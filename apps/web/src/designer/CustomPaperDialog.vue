<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDialog } from 'element-plus';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', size: { w_mm: number; h_mm: number }): void;
}>();

const PX_PER_MM = 4;

const w = ref<number>(210);
const h = ref<number>(297);

function open(): void {
  w.value = 210;
  h.value = 297;
}
watch(
  () => props.modelValue,
  (v) => {
    if (v) open();
  },
);

function divisors(n: number, min = 2, max = 40): number[] {
  const out: number[] = [];
  for (let i = min; i <= max && i <= n; i++) if (n % i === 0) out.push(i);
  return out;
}

const pxW = computed(() => w.value * PX_PER_MM);
const pxH = computed(() => h.value * PX_PER_MM);

const cellOptions = computed(() => {
  const a = divisors(pxW.value);
  const b = divisors(pxH.value);
  return a.filter((d) => b.includes(d));
});

const aspectOk = computed(() => {
  const r = Math.max(w.value, h.value) / Math.min(w.value, h.value);
  return r <= 5;
});

const inRange = computed(() => w.value >= 30 && w.value <= 600 && h.value >= 30 && h.value <= 600);
const isPrime = (n: number): boolean => {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
};
const primeSide = computed(() => isPrime(w.value) || isPrime(h.value));

function nearbyNonPrime(n: number): number {
  for (let d = 1; d < 8; d++) {
    if (!isPrime(n - d) && n - d >= 30) return n - d;
    if (!isPrime(n + d) && n + d <= 600) return n + d;
  }
  return n;
}

const canConfirm = computed(() => inRange.value && aspectOk.value);

function confirm(): void {
  if (!canConfirm.value) return;
  emit('confirm', { w_mm: Math.round(w.value), h_mm: Math.round(h.value) });
  emit('update:modelValue', false);
}

function setW(v: string): void {
  w.value = Math.max(0, Math.floor(Number(v) || 0));
}
function setH(v: string): void {
  h.value = Math.max(0, Math.floor(Number(v) || 0));
}
</script>

<template>
  <ElDialog
    :model-value="props.modelValue"
    title="自定义画布"
    width="480px"
    align-center
    :append-to-body="true"
    :z-index="3000"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="cpd-form">
      <div class="cpd-row">
        <label class="lbl">宽 <span class="unit">(mm)</span></label>
        <input
          type="text"
          :value="String(w)"
          @input="(e) => setW((e.target as HTMLInputElement).value)"
        />
      </div>
      <div class="cpd-row">
        <label class="lbl">高 <span class="unit">(mm)</span></label>
        <input
          type="text"
          :value="String(h)"
          @input="(e) => setH((e.target as HTMLInputElement).value)"
        />
      </div>

      <div class="cpd-info">
        <div class="info-line">
          <span class="dot"></span>
          <span class="k">画布像素</span>
          <span class="v">{{ pxW }} × {{ pxH }}</span>
        </div>
        <div v-if="!inRange" class="info-line danger">⚠ 每边需在 30 - 600 mm 范围内</div>
        <div v-else-if="!aspectOk" class="info-line danger">⚠ 长宽比超过 5:1，不允许</div>
        <div v-else-if="cellOptions.length === 0" class="info-line warn">
          ⚠ 此尺寸无公约 cell 候选 (2-40 px)，将使用 cell=1px 回退
        </div>
        <div v-else class="info-line">
          <span class="dot"></span>
          <span class="k">可选 cell</span>
          <span class="v">{{ cellOptions.join(', ') }} px ({{ cellOptions.length }} 个)</span>
        </div>
        <div v-if="primeSide && canConfirm && cellOptions.length > 0" class="info-line warn">
          ⚠ 边长含质数 ({{ w }} 或 {{ h }})，cell 选项受限。建议改为
          {{ isPrime(w) ? nearbyNonPrime(w) : w }} × {{ isPrime(h) ? nearbyNonPrime(h) : h }} mm
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary sm" type="button" @click="emit('update:modelValue', false)">
        取消
      </button>
      <button class="btn btn-primary sm" type="button" :disabled="!canConfirm" @click="confirm">
        确定
      </button>
    </template>
  </ElDialog>
</template>

<style scoped>
.cpd-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cpd-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 12px;
}
.cpd-row .lbl {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
}
.cpd-row .lbl .unit {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  margin-left: 4px;
}
.cpd-row input {
  height: 36px;
  padding: 0 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  color: var(--ink);
  background: var(--paper-white);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-default);
}
.cpd-row input:focus {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}

.cpd-info {
  margin-top: 4px;
  padding: 12px 14px;
  background: var(--mist);
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.info-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
  line-height: 1.5;
}
.info-line .dot {
  width: 6px;
  height: 6px;
  background: var(--yangli-red);
  flex-shrink: 0;
}
.info-line .k {
  color: var(--fg-3);
  margin-right: 2px;
}
.info-line .v {
  color: var(--ink);
}
.info-line.danger {
  color: var(--yangli-red);
  font-family: var(--font-han);
}
.info-line.warn {
  color: #8b6500;
  font-family: var(--font-han);
}
</style>
