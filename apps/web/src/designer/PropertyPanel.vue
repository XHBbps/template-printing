<script setup lang="ts">
import { ElButton, ElInput, ElOption, ElSelect } from 'element-plus';
import { computed, ref } from 'vue';
// eslint-disable-next-line import/no-unresolved
import type { ElementStyle, TemplateElement } from '@template-printing/schema';

import { useDesignerStore } from '../stores/designer';
import { useImageUpload } from '../composables/useImageUpload';
import { allowedFieldTypesForElement, minMmFor } from './elementFactory';
import BarcodeProperties from './BarcodeProperties.vue';
import QrProperties from './QrProperties.vue';
import SliderWithInput from './SliderWithInput.vue';
import BorderControl from './BorderControl.vue';
import PaddingControl from './PaddingControl.vue';
// eslint-disable-next-line import/no-unresolved
import { Trash2 } from 'lucide-vue-next';

const store = useDesignerStore();
const { upload, uploading, error: uploadError } = useImageUpload();

const sel = computed<TemplateElement | null>(() => store.selectedElement);

const minMmCurrent = computed(() => (sel.value ? minMmFor(sel.value) : { w: 0.25, h: 0.25 }));

const compatibleFields = computed(() => {
  if (!sel.value) return [];
  const allowed = allowedFieldTypesForElement(sel.value.type);
  return store.fieldDefs.filter((f) => allowed.includes(f.def.type));
});

const currentBindingMissing = computed(() => {
  if (!sel.value || !('binding' in sel.value)) return false;
  const b = (sel.value as { binding?: string }).binding;
  if (!b) return false;
  return !compatibleFields.value.some((f) => f.key === b);
});

function updateStyleBorder(v: ElementStyle['border']): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, border: v },
  } as Partial<TemplateElement>);
}

function updateStylePadding(v: ElementStyle['padding']): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, padding: v },
  } as Partial<TemplateElement>);
}

function onAnchorInput(key: 'x' | 'y' | 'w' | 'h', e: Event): void {
  if (!sel.value) return;
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  let min: number;
  if (key === 'w') min = minMmCurrent.value.w;
  else if (key === 'h') min = minMmCurrent.value.h;
  else min = 0;
  store.setElementAnchor(sel.value.id, { [key]: Math.max(min, v) });
}

function setTextContent(v: string): void {
  if (!sel.value || sel.value.type !== 'text') return;
  store.updateElement(sel.value.id, { content: { static: v } } as Partial<TemplateElement>);
}

function setBinding(v: string): void {
  if (!sel.value) return;
  if (sel.value.type === 'field' || sel.value.type === 'table') {
    store.updateElement(sel.value.id, { binding: v } as Partial<TemplateElement>);
  }
}

type ImageSourceKind = 'static' | 'field' | 'upload';
function setImageSourceKind(kind: ImageSourceKind): void {
  if (!sel.value || sel.value.type !== 'image') return;
  if (kind === 'static' || kind === 'upload') {
    store.updateElement(sel.value.id, {
      source: { kind: 'static', url: '' },
    } as Partial<TemplateElement>);
  } else {
    store.updateElement(sel.value.id, {
      source: { kind: 'field', binding: '' },
    } as Partial<TemplateElement>);
  }
}
function setStaticUrl(v: string): void {
  if (!sel.value || sel.value.type !== 'image') return;
  store.updateElement(sel.value.id, {
    source: { kind: 'static', url: v },
  } as Partial<TemplateElement>);
}
function setFieldBinding(v: string): void {
  if (!sel.value || sel.value.type !== 'image') return;
  store.updateElement(sel.value.id, {
    source: { kind: 'field', binding: v },
  } as Partial<TemplateElement>);
}
async function onFileChange(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const r = await upload(file);
  if (r && sel.value && sel.value.type === 'image') {
    store.updateElement(sel.value.id, {
      source: { kind: 'static', url: r.url },
    } as Partial<TemplateElement>);
  }
}

function del(): void {
  if (!sel.value) return;
  store.deleteElement(sel.value.id);
}

function updateStyle(patch: Partial<ElementStyle>): void {
  if (!sel.value) return;
  store.updateElement(sel.value.id, {
    style: { ...sel.value.style, ...patch },
  } as Partial<TemplateElement>);
}

function isTextish(el: TemplateElement | null): boolean {
  if (!el) return false;
  return ['text', 'field', 'autonumber', 'system', 'table'].includes(el.type);
}

const advancedOpen = ref(false);
</script>

<template>
  <div class="tp-section-bottom prop-panel">
    <div class="tp-sub-head">
      <span class="tp-sub-title">属性</span>
      <span v-if="sel" class="tp-sub-hint">已选 {{ store.selectedIds.length }} 个</span>
    </div>

    <div v-if="!sel" class="empty">未选中任何元素</div>

    <div v-else class="prop-body">
      <div class="row">
        <span class="lbl">类型</span>
        <span class="val mono">{{ sel.type }}</span>
      </div>

      <!-- 位置 — anchor.x / anchor.y in mm -->
      <div class="row row-axis">
        <span class="lbl">位置</span>
        <div class="axis-pair">
          <label class="axis">
            <span class="axis-lbl">列</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.x.toFixed(2)"
              step="0.25"
              min="0"
              @input="(e: Event) => onAnchorInput('x', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
          <label class="axis">
            <span class="axis-lbl">行</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.y.toFixed(2)"
              step="0.25"
              min="0"
              @input="(e: Event) => onAnchorInput('y', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
        </div>
      </div>
      <div class="row row-badge">
        <span class="lbl"></span>
        <span class="cell-eq"
          >≈ {{ sel.grid.c }} × {{ sel.grid.r }} 格 @ cell={{
            store.template.canvas.cell.w
          }}px</span
        >
      </div>

      <!-- 尺寸 — anchor.w / anchor.h in mm -->
      <div class="row row-axis">
        <span class="lbl">尺寸</span>
        <div class="axis-pair">
          <label class="axis">
            <span class="axis-lbl">宽</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.w.toFixed(2)"
              step="0.25"
              :min="minMmCurrent.w"
              @input="(e: Event) => onAnchorInput('w', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
          <label class="axis">
            <span class="axis-lbl">高</span>
            <input
              type="number"
              class="axis-input"
              :value="sel.anchor.h.toFixed(2)"
              step="0.25"
              :min="minMmCurrent.h"
              @input="(e: Event) => onAnchorInput('h', e)"
            />
            <span class="axis-unit">mm</span>
          </label>
        </div>
      </div>
      <div class="row row-badge">
        <span class="lbl"></span>
        <span class="cell-eq">≈ {{ sel.grid.cs }} × {{ sel.grid.rs }} 格</span>
      </div>

      <div v-if="sel.type === 'text'" class="row">
        <span class="lbl">内容</span>
        <ElInput
          size="small"
          :model-value="sel.content.static"
          style="flex: 1"
          @update:model-value="setTextContent"
        />
      </div>

      <!-- 绑定 — field (with (未绑定) sentinel + type-filtered options + warning) -->
      <div v-if="sel && sel.type === 'field'" class="row">
        <span class="lbl">绑定</span>
        <ElSelect
          size="small"
          :model-value="sel.binding"
          style="flex: 1"
          @change="(v: string) => setBinding(v)"
        >
          <ElOption value="" label="（未绑定）" />
          <ElOption
            v-for="f in compatibleFields"
            :key="f.key"
            :value="f.key"
            :label="`${f.key} · ${f.def.label}`"
          />
          <ElOption
            v-if="currentBindingMissing"
            :value="sel.binding"
            :label="`⚠ ${sel.binding} (类型不兼容)`"
            disabled
          />
        </ElSelect>
      </div>

      <!-- 绑定 — table (binding required, no (未绑定) option) -->
      <div v-if="sel && sel.type === 'table'" class="row">
        <span class="lbl">绑定</span>
        <ElSelect
          size="small"
          :model-value="sel.binding"
          style="flex: 1"
          @change="(v: string) => setBinding(v)"
        >
          <ElOption
            v-for="f in compatibleFields"
            :key="f.key"
            :value="f.key"
            :label="`${f.key} · ${f.def.label}`"
          />
        </ElSelect>
      </div>

      <div v-if="isTextish(sel)" class="style-block">
        <div class="style-title">样式 · 基础</div>

        <div class="srow">
          <span class="slbl">颜色</span>
          <input
            type="color"
            :value="sel.style.color ?? '#1F1F23'"
            @input="(e: Event) => updateStyle({ color: (e.target as HTMLInputElement).value })"
          />
          <span class="sval mono">{{ sel.style.color ?? '#1F1F23' }}</span>
        </div>

        <div class="srow">
          <span class="slbl">字号</span>
          <input
            type="number"
            :value="sel.style.fontSize ?? 14"
            min="6"
            max="72"
            step="1"
            class="snum"
            @input="
              (e: Event) => updateStyle({ fontSize: Number((e.target as HTMLInputElement).value) })
            "
          />
          <span class="sval">px</span>
        </div>

        <div class="srow">
          <span class="slbl">粗细</span>
          <select
            :value="sel.style.fontWeight ?? 400"
            class="ssel"
            @change="
              (e: Event) =>
                updateStyle({
                  fontWeight: Number((e.target as HTMLSelectElement).value) as
                    | 400
                    | 500
                    | 600
                    | 700,
                })
            "
          >
            <option :value="400">偏细</option>
            <option :value="500">常规</option>
            <option :value="600">加粗</option>
            <option :value="700">特粗</option>
          </select>
        </div>

        <div class="srow">
          <span class="slbl">对齐</span>
          <div class="seg">
            <button
              v-for="a in ['left', 'center', 'right', 'justify'] as const"
              :key="a"
              :class="{ on: sel.style.textAlign === a }"
              @click="updateStyle({ textAlign: a })"
            >
              {{ { left: '左', center: '中', right: '右', justify: '两端' }[a] }}
            </button>
          </div>
        </div>
      </div>

      <!-- 样式 · 高级 — text-only rows (fontFamily / letterSpacing / lineHeight / textDecoration / verticalAlign / textOverflow) -->
      <div v-if="isTextish(sel)" class="style-block">
        <div class="style-title sclickable" @click="advancedOpen = !advancedOpen">
          样式 · 高级 <span class="caret">{{ advancedOpen ? '▾' : '▸' }}</span>
        </div>
        <div v-if="advancedOpen">
          <div class="srow">
            <span class="slbl">字体</span>
            <select
              :value="sel.style.fontFamily ?? 'sans'"
              class="ssel"
              @change="
                (e: Event) =>
                  updateStyle({
                    fontFamily: (e.target as HTMLSelectElement).value as 'sans' | 'serif' | 'mono',
                  })
              "
            >
              <option value="sans">无衬线</option>
              <option value="serif">衬线</option>
              <option value="mono">等宽</option>
            </select>
          </div>
          <div class="srow">
            <span class="slbl">字间距</span>
            <input
              type="number"
              step="0.1"
              :value="sel.style.letterSpacing ?? 0"
              class="snum"
              @input="
                (e: Event) =>
                  updateStyle({ letterSpacing: Number((e.target as HTMLInputElement).value) })
              "
            />
            <span class="sval">px</span>
          </div>
          <div class="srow">
            <span class="slbl">行高</span>
            <input
              type="number"
              step="0.1"
              min="0.8"
              :value="sel.style.lineHeight ?? 1.4"
              class="snum"
              @input="
                (e: Event) =>
                  updateStyle({ lineHeight: Number((e.target as HTMLInputElement).value) })
              "
            />
          </div>
          <div class="srow">
            <span class="slbl">装饰</span>
            <select
              :value="sel.style.textDecoration ?? 'none'"
              class="ssel"
              @change="
                (e: Event) =>
                  updateStyle({
                    textDecoration: (e.target as HTMLSelectElement).value as
                      | 'none'
                      | 'underline'
                      | 'overline'
                      | 'line-through',
                  })
              "
            >
              <option value="none">无</option>
              <option value="underline">下划线</option>
              <option value="overline">上划线</option>
              <option value="line-through">删除线</option>
            </select>
          </div>
          <div class="srow">
            <span class="slbl">垂直对齐</span>
            <div class="seg">
              <button
                v-for="v in ['top', 'middle', 'bottom'] as const"
                :key="v"
                :class="{ on: (sel.style.verticalAlign ?? 'middle') === v }"
                @click="updateStyle({ verticalAlign: v })"
              >
                {{ { top: '上', middle: '中', bottom: '下' }[v] }}
              </button>
            </div>
          </div>
          <div class="srow">
            <span class="slbl">溢出</span>
            <select
              :value="sel.style.textOverflow ?? 'wrap'"
              class="ssel"
              @change="
                (e: Event) =>
                  updateStyle({
                    textOverflow: (e.target as HTMLSelectElement).value as
                      | 'clip'
                      | 'ellipsis'
                      | 'wrap',
                  })
              "
            >
              <option value="wrap">换行</option>
              <option value="clip">裁剪</option>
              <option value="ellipsis">省略号</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 布局 · 高级 — universal (backgroundColor / zIndex / rotation / opacity) -->
      <div v-if="sel" class="style-block">
        <div class="style-title sclickable" @click="advancedOpen = !advancedOpen">
          布局 · 高级 <span class="caret">{{ advancedOpen ? '▾' : '▸' }}</span>
        </div>
        <div v-if="advancedOpen">
          <div class="srow">
            <span class="slbl">背景色</span>
            <input
              type="color"
              :value="sel.style.backgroundColor ?? '#ffffff'"
              @input="
                (e: Event) => updateStyle({ backgroundColor: (e.target as HTMLInputElement).value })
              "
            />
          </div>
          <div class="srow">
            <span class="slbl">层级 z</span>
            <input
              type="number"
              :value="sel.style.zIndex ?? 0"
              class="snum"
              @input="
                (e: Event) => updateStyle({ zIndex: Number((e.target as HTMLInputElement).value) })
              "
            />
          </div>
          <div class="srow">
            <span class="slbl">旋转</span>
            <SliderWithInput
              :model-value="sel.style.rotation ?? 0"
              :min="-180"
              :max="180"
              :step="1"
              :format="(v: number) => `${v}°`"
              @update:model-value="(v: number) => updateStyle({ rotation: v })"
            />
          </div>
          <div class="srow">
            <span class="slbl">透明度</span>
            <SliderWithInput
              :model-value="Math.round((sel.style.opacity ?? 1) * 100)"
              :min="0"
              :max="100"
              :step="1"
              :format="(v: number) => `${v}%`"
              @update:model-value="(v: number) => updateStyle({ opacity: v / 100 })"
            />
          </div>
        </div>
      </div>

      <BarcodeProperties
        v-if="sel && sel.type === 'barcode'"
        :element="sel"
        @update="(patch: Partial<TemplateElement>) => store.updateElement(sel!.id, patch)"
      />
      <QrProperties
        v-if="sel && sel.type === 'qr'"
        :element="sel"
        @update="(patch: Partial<TemplateElement>) => store.updateElement(sel!.id, patch)"
      />

      <div v-if="sel && sel.type === 'image'" class="img-source">
        <div class="style-title">图片来源</div>
        <div class="srow">
          <div class="seg">
            <button
              :class="{
                on: sel.source.kind === 'static' && !sel.source.url.startsWith('/uploads/'),
              }"
              @click="setImageSourceKind('static')"
            >
              URL
            </button>
            <button
              :class="{
                on: sel.source.kind === 'static' && sel.source.url.startsWith('/uploads/'),
              }"
              @click="setImageSourceKind('upload')"
            >
              上传
            </button>
            <button
              :class="{ on: sel.source.kind === 'field' }"
              @click="setImageSourceKind('field')"
            >
              绑定字段
            </button>
          </div>
        </div>

        <div
          v-if="sel.source.kind === 'static' && !sel.source.url.startsWith('/uploads/')"
          class="srow"
        >
          <input
            class="snum"
            style="flex: 1"
            :value="sel.source.url"
            @input="(e: Event) => setStaticUrl((e.target as HTMLInputElement).value)"
            placeholder="https://..."
          />
        </div>
        <div v-else-if="sel.source.kind === 'static'" class="srow">
          <input type="file" accept="image/svg+xml,image/png,image/jpeg" @change="onFileChange" />
          <span v-if="uploading" class="sval">上传中…</span>
          <span v-if="uploadError" class="sval" style="color: #d94f4f">{{ uploadError }}</span>
          <span v-if="sel.source.url" class="sval mono">{{ sel.source.url }}</span>
        </div>
        <div v-else class="srow">
          <select
            class="ssel"
            style="flex: 1"
            :value="sel.source.binding"
            @change="(e: Event) => setFieldBinding((e.target as HTMLSelectElement).value)"
          >
            <option value="">(选择字段)</option>
            <option
              v-for="f in store.fieldDefs.filter((x) => x.def.type === 'image')"
              :key="f.key"
              :value="f.key"
            >
              {{ f.key }} · {{ f.def.label }}
            </option>
          </select>
        </div>
      </div>

      <BorderControl :model-value="sel.style.border" @update:model-value="updateStyleBorder" />
      <PaddingControl :model-value="sel.style.padding" @update:model-value="updateStylePadding" />

      <div style="padding: 12px 16px">
        <ElButton type="danger" plain size="small" style="width: 100%" @click="del">
          <Trash2 :size="14" :stroke-width="2" />
          <span style="margin-left: 6px">删除元素</span>
        </ElButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prop-panel {
  font-size: 12px;
  overflow-y: auto;
}
.prop-body {
  padding: 4px 0 12px;
}
.empty {
  padding: 32px 16px;
  color: var(--tp-ink-faint);
  text-align: center;
  font-size: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
}
.row-axis {
  gap: 8px;
}
.lbl {
  color: var(--tp-ink-soft);
  min-width: 36px;
  font-size: 11px;
  letter-spacing: 0.03em;
}
.val {
  color: var(--tp-ink);
}
.mono {
  font-family: ui-monospace, monospace;
}

/* Axis pill — 列/行/宽/高 (#6) */
.axis-pair {
  display: flex;
  gap: 6px;
  flex: 1;
}
.axis {
  flex: 1;
  display: flex;
  align-items: stretch;
  background: var(--tp-field-bg);
  border: 1px solid transparent;
  border-radius: var(--tp-radius-item);
  overflow: hidden;
  transition: border-color 120ms ease;
  min-width: 0;
}
.axis:focus-within {
  border-color: var(--tp-accent);
  background: #fff;
}
.axis-lbl {
  background: var(--tp-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.axis-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--tp-ink);
  outline: none;
  font-family: ui-monospace, monospace;
  min-width: 0;
  width: 100%;
}
.axis-input::-webkit-outer-spin-button,
.axis-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.axis-input[type='number'] {
  -moz-appearance: textfield;
}
.axis-unit {
  background: transparent;
  color: var(--tp-ink-faint);
  font-size: 10px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.row-badge {
  padding: 0 14px 4px;
  font-size: 10.5px;
  color: var(--tp-ink-faint);
}
.row-badge .lbl {
  min-width: 36px;
}
.cell-eq {
  font-family: ui-monospace, monospace;
}
.style-block {
  padding: 12px 14px;
  border-bottom: 1px solid var(--tp-line);
}
.style-title {
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
  width: 36px;
  font-size: 11px;
  color: var(--tp-ink-soft);
}
.sval {
  font-size: 11px;
  color: var(--tp-ink-soft);
}
.snum,
.ssel {
  padding: 3px 6px;
  border: 1px solid var(--tp-line-strong);
  border-radius: 4px;
  font-size: 12px;
  min-width: 80px;
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
.sclickable {
  cursor: pointer;
  user-select: none;
  display: flex;
  justify-content: space-between;
}
.caret {
  color: var(--tp-ink-faint);
}
.slider {
  flex: 1;
  accent-color: var(--tp-accent);
}
.img-source {
  padding: 12px 14px;
  border-bottom: 1px solid var(--tp-line);
}
</style>
