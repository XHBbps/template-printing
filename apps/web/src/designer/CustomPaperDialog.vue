<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElButton, ElDialog, ElInput } from 'element-plus';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', size: { w_mm: number; h_mm: number }): void;
}>();

const PX_PER_MM = 4;

const w = ref<number>(210);
const h = ref<number>(297);

function open() {
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
const isPrime = (n: number) => {
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

// Allow confirm even when cellOptions is empty — store falls back to cell=1
// for low-divisor papers (iteration 4 behavior). The dialog already shows
// a red warning explaining the constraint.
const canConfirm = computed(() => inRange.value && aspectOk.value);

function confirm() {
  emit('confirm', { w_mm: Math.round(w.value), h_mm: Math.round(h.value) });
  emit('update:modelValue', false);
}
</script>

<template>
  <ElDialog
    :model-value="props.modelValue"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    title="自定义画布"
    width="420px"
  >
    <div class="cpd-row">
      <label>宽 (mm)</label>
      <ElInput
        :model-value="String(w)"
        @update:model-value="(v: string) => (w = Math.max(0, Math.floor(Number(v) || 0)))"
      />
    </div>
    <div class="cpd-row">
      <label>高 (mm)</label>
      <ElInput
        :model-value="String(h)"
        @update:model-value="(v: string) => (h = Math.max(0, Math.floor(Number(v) || 0)))"
      />
    </div>

    <div class="cpd-preview">
      <div>画布像素：{{ pxW }} × {{ pxH }}</div>
      <div v-if="!inRange" class="cpd-error">⚠ 每边需在 30 - 600 mm 范围内</div>
      <div v-else-if="!aspectOk" class="cpd-error">⚠ 长宽比超过 5:1，不允许</div>
      <div v-else-if="cellOptions.length === 0" class="cpd-warn">
        ⚠ 此尺寸无公约 cell 候选 (2-40 px)，将使用 cell=1px 回退，建议调整为附近的高公约数值
      </div>
      <div v-else>可选 cell：{{ cellOptions.join(', ') }} px ({{ cellOptions.length }} 个)</div>
      <div v-if="primeSide && canConfirm && cellOptions.length > 0" class="cpd-warn">
        ⚠ 边长含质数 ({{ w }} 或 {{ h }})，cell 选项受限。建议改为
        {{ isPrime(w) ? nearbyNonPrime(w) : w }} × {{ isPrime(h) ? nearbyNonPrime(h) : h }} mm
      </div>
    </div>

    <template #footer>
      <ElButton @click="emit('update:modelValue', false)">取消</ElButton>
      <ElButton type="primary" :disabled="!canConfirm" @click="confirm">确定</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.cpd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.cpd-row label {
  width: 60px;
  color: var(--tp-ink-soft);
  font-size: 12px;
}
.cpd-preview {
  margin-top: 8px;
  padding: 10px;
  background: var(--tp-field-bg);
  border-radius: 8px;
  font-size: 12px;
  color: var(--tp-ink-soft);
  line-height: 1.8;
}
.cpd-error {
  color: #d94f4f;
  font-weight: 600;
}
.cpd-warn {
  color: #a16a00;
}
</style>
