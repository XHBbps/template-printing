<script setup lang="ts">
/* eslint-disable import/no-unresolved */
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-vue-next';
/* eslint-enable import/no-unresolved */
import { ref, computed, watch, onBeforeUnmount } from 'vue';

/**
 * 扬力品牌自定义日期时间选择器（替代原生 datetime-local，原生无法风格化）。
 * v-model 值为本地 datetime-local 字符串 `YYYY-MM-DDTHH:mm`（`new Date()` 按本地时区解析），
 * 与父级 `new Date(value).toISOString()` 逻辑兼容；清除时发空串。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
  }>(),
  { placeholder: '年 / 月 / 日 --:--' },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const pad = (n: number): string => String(n).padStart(2, '0');

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

// 当前展示的年月
const viewYear = ref(0);
const viewMonth = ref(0); // 0-11
// 草稿选择（确定前不提交）
const selY = ref<number | null>(null);
const selM = ref<number | null>(null);
const selD = ref<number | null>(null);
const hh = ref('00');
const mm = ref('00');

const MONTH_MONO = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

// 触发器显示文案
const displayText = computed(() => {
  if (!props.modelValue) return props.placeholder;
  const d = new Date(props.modelValue);
  if (Number.isNaN(d.getTime())) return props.placeholder;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

const monthLabel = computed(() => `${viewYear.value} 年 ${pad(viewMonth.value + 1)} 月`);
const monthMono = computed(() => MONTH_MONO[viewMonth.value]);

interface Cell {
  day: number;
  y: number;
  m: number;
  inMonth: boolean;
}

// 周一为首列的 6×7 网格
const grid = computed<Cell[]>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const offset = (first.getDay() + 6) % 7; // 距离周一的前置天数
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(viewYear.value, viewMonth.value, 1 - offset + i);
    cells.push({
      day: d.getDate(),
      y: d.getFullYear(),
      m: d.getMonth(),
      inMonth: d.getMonth() === viewMonth.value,
    });
  }
  return cells;
});

const today = new Date();
function isToday(c: Cell): boolean {
  return c.y === today.getFullYear() && c.m === today.getMonth() && c.day === today.getDate();
}
function isSelected(c: Cell): boolean {
  return c.y === selY.value && c.m === selM.value && c.day === selD.value;
}

function syncDraftFromValue(): void {
  const base = props.modelValue ? new Date(props.modelValue) : null;
  const valid = base && !Number.isNaN(base.getTime());
  const d = valid ? (base as Date) : new Date();
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
  if (valid) {
    selY.value = d.getFullYear();
    selM.value = d.getMonth();
    selD.value = d.getDate();
    hh.value = pad(d.getHours());
    mm.value = pad(d.getMinutes());
  } else {
    selY.value = null;
    selM.value = null;
    selD.value = null;
    hh.value = '00';
    mm.value = '00';
  }
}

function toggle(): void {
  if (open.value) {
    open.value = false;
    return;
  }
  syncDraftFromValue();
  open.value = true;
}
function close(): void {
  open.value = false;
}

function prevMonth(): void {
  if (viewMonth.value === 0) {
    viewMonth.value = 11;
    viewYear.value -= 1;
  } else {
    viewMonth.value -= 1;
  }
}
function nextMonth(): void {
  if (viewMonth.value === 11) {
    viewMonth.value = 0;
    viewYear.value += 1;
  } else {
    viewMonth.value += 1;
  }
}

function pickDay(c: Cell): void {
  selY.value = c.y;
  selM.value = c.m;
  selD.value = c.day;
  if (!c.inMonth) {
    viewYear.value = c.y;
    viewMonth.value = c.m;
  }
}

// 时分输入：仅留数字、限位
function sanitizeHour(): void {
  const n = Math.min(23, Math.max(0, parseInt(hh.value.replace(/\D/g, ''), 10) || 0));
  hh.value = pad(n);
}
function sanitizeMinute(): void {
  const n = Math.min(59, Math.max(0, parseInt(mm.value.replace(/\D/g, ''), 10) || 0));
  mm.value = pad(n);
}

function setToday(): void {
  const d = new Date();
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
  selY.value = d.getFullYear();
  selM.value = d.getMonth();
  selD.value = d.getDate();
  hh.value = pad(d.getHours());
  mm.value = pad(d.getMinutes());
}

function clear(): void {
  emit('update:modelValue', '');
  close();
}

function confirm(): void {
  if (selY.value === null || selM.value === null || selD.value === null) {
    clear();
    return;
  }
  sanitizeHour();
  sanitizeMinute();
  const value = `${selY.value}-${pad(selM.value + 1)}-${pad(selD.value)}T${hh.value}:${mm.value}`;
  emit('update:modelValue', value);
  close();
}

// 外部点击 / Esc 关闭
function onDocPointer(e: MouseEvent): void {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) close();
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('mousedown', onDocPointer);
    document.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointer);
  document.removeEventListener('keydown', onKey);
});

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
</script>

<template>
  <div ref="rootEl" class="dt">
    <button
      type="button"
      class="dt-trigger"
      :class="{ open, placeholder: !modelValue }"
      @click="toggle"
    >
      {{ displayText }}
      <span class="cal-ico"><Calendar :size="14" :stroke-width="1.6" /></span>
    </button>

    <div v-if="open" class="dp">
      <div class="dp-head">
        <div class="ym">
          {{ monthLabel }} <span class="mono">{{ monthMono }}</span>
        </div>
        <div class="dp-nav">
          <button type="button" title="上个月" @click="prevMonth">
            <ChevronLeft :size="14" :stroke-width="1.6" />
          </button>
          <button type="button" title="下个月" @click="nextMonth">
            <ChevronRight :size="14" :stroke-width="1.6" />
          </button>
        </div>
      </div>

      <div class="dp-week">
        <span v-for="(w, i) in WEEKDAYS" :key="i">{{ w }}</span>
      </div>

      <div class="dp-grid">
        <button
          v-for="(c, i) in grid"
          :key="i"
          type="button"
          :class="{ dim: !c.inMonth, today: isToday(c), selected: isSelected(c) }"
          @click="pickDay(c)"
        >
          {{ c.day }}
        </button>
      </div>

      <div class="dp-time">
        <span class="lbl">Time · 时分</span>
        <div class="group">
          <input
            v-model="hh"
            type="text"
            inputmode="numeric"
            maxlength="2"
            aria-label="时"
            @blur="sanitizeHour"
          />
          <span class="sep">:</span>
          <input
            v-model="mm"
            type="text"
            inputmode="numeric"
            maxlength="2"
            aria-label="分"
            @blur="sanitizeMinute"
          />
        </div>
      </div>

      <div class="dp-foot">
        <button type="button" class="ghost" @click="clear">清除</button>
        <div class="foot-right">
          <button type="button" class="ghost" @click="setToday">今天</button>
          <button type="button" class="btn btn-primary" @click="confirm">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dt {
  position: relative;
}

/* 触发器 */
.dt-trigger {
  position: relative;
  height: 38px;
  width: 100%;
  padding: 0 36px 0 12px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-white);
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-default);
}
.dt-trigger:hover {
  border-color: var(--yangli-graphite);
}
.dt-trigger.open {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}
.dt-trigger.placeholder {
  color: var(--fg-3);
}
.dt-trigger .cal-ico {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--fg-3);
  pointer-events: none;
  display: inline-flex;
}

/* Popover */
.dp {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: 320px;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-top: 2px solid var(--yangli-red);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-1);
  z-index: 30;
}
.dp-head {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--stone);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dp-head .ym {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--ink);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}
.dp-head .ym .mono {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.04em;
  margin-left: 6px;
}
.dp-head .dp-nav {
  display: flex;
  flex-direction: row;
  gap: 2px;
}
.dp-head .dp-nav button {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--fg-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dp-head .dp-nav button:hover {
  color: var(--ink);
}

.dp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 8px 12px 4px;
}
.dp-week span {
  text-align: center;
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 4px 0;
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0 12px 8px;
  gap: 2px;
}
.dp-grid button {
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  border-radius: var(--radius-1);
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
}
.dp-grid button.dim {
  color: var(--fg-3);
}
.dp-grid button:hover {
  background: var(--mist);
  color: var(--ink);
}
.dp-grid button.today {
  box-shadow: inset 0 -2px 0 var(--yangli-red);
  color: var(--yangli-red);
}
.dp-grid button.range {
  background: rgba(28, 28, 28, 0.06);
  color: var(--ink);
}
.dp-grid button.selected {
  background: var(--ink);
  color: var(--paper-white);
  box-shadow: none;
}

/* 时分行 */
.dp-time {
  border-top: 1px solid var(--stone);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dp-time .lbl {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dp-time .group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dp-time .group input {
  width: 36px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink);
  background: var(--paper-white);
  text-align: center;
  outline: none;
}
.dp-time .group input:focus {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}
.dp-time .group .sep {
  font-family: var(--font-mono);
  color: var(--fg-3);
}

/* 底部 */
.dp-foot {
  border-top: 1px solid var(--stone);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dp-foot .foot-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dp-foot .ghost {
  border: none;
  background: none;
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-2);
  cursor: pointer;
  padding: 0;
}
.dp-foot .ghost:hover {
  color: var(--yangli-red);
}
.dp-foot .btn-primary {
  height: 28px;
  padding: 0 14px;
  font-size: 12.5px;
}
</style>
