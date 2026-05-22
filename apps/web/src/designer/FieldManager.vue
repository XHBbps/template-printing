<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElCheckbox,
} from 'element-plus';
import { ref, computed } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Plus, Pencil, Trash2, Search } from 'lucide-vue-next';
import { useDesignerStore } from '../stores/designer';

type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum' | 'image' | 'array';

const store = useDesignerStore();

const searchQuery = ref('');

const filteredFields = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return store.fieldDefs;
  return store.fieldDefs.filter(
    (f) => f.key.toLowerCase().includes(q) || f.def.label.toLowerCase().includes(q),
  );
});
const dialogOpen = ref(false);
const dialogMode = ref<'add' | 'edit'>('add');

interface FormShape {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  example: string;
  maxLength?: number;
  thousands?: boolean;
  format?: string;
  trueLabel?: string;
  falseLabel?: string;
  options?: Array<{ value: string; label: string }>;
  accept?: string[];
}

const form = ref<FormShape>(defaultForm());

function defaultForm(): FormShape {
  return { key: '', label: '', type: 'string', required: false, example: '' };
}

function openAdd(): void {
  dialogMode.value = 'add';
  form.value = defaultForm();
  dialogOpen.value = true;
}

function openEdit(key: string): void {
  const def = store.template.schema[key];
  if (!def) return;
  dialogMode.value = 'edit';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = def as any;
  form.value = {
    key,
    label: d.label ?? '',
    type: d.type ?? 'string',
    required: d.required ?? false,
    example: d.example ?? '',
    maxLength: d.maxLength,
    thousands: d.thousands,
    format: d.format,
    trueLabel: d.trueLabel,
    falseLabel: d.falseLabel,
    options: d.options ? [...d.options] : undefined,
    accept: d.accept ? [...d.accept] : undefined,
  };
  dialogOpen.value = true;
}

function addOptionRow(): void {
  if (!form.value.options) form.value.options = [];
  form.value.options.push({ value: '', label: '' });
}
function removeOptionRow(i: number): void {
  form.value.options?.splice(i, 1);
}

function toggleAcc(arr: string[] | undefined, mime: string, on: boolean): string[] {
  const cur = arr ?? ['image/svg+xml', 'image/png', 'image/jpeg'];
  if (on) return cur.includes(mime) ? cur : [...cur, mime];
  return cur.filter((m) => m !== mime);
}

function submit(): void {
  const f = form.value;
  if (!f.key || !f.label) {
    ElMessage.warning('key 和 label 都必须填');
    return;
  }
  if (dialogMode.value === 'add' && store.template.schema[f.key]) {
    ElMessage.error(`变量 "${f.key}" 已存在`);
    return;
  }

  const base = { label: f.label, required: f.required, example: f.example || undefined };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let def: any;
  if (f.type === 'string')
    def = { type: 'string' as const, ...base, ...(f.maxLength ? { maxLength: f.maxLength } : {}) };
  else if (f.type === 'number')
    def = { type: 'number' as const, ...base, thousands: f.thousands ?? false };
  else if (f.type === 'date')
    def = { type: 'date' as const, ...base, format: f.format || 'YYYY-MM-DD' };
  else if (f.type === 'datetime')
    def = { type: 'datetime' as const, ...base, format: f.format || 'YYYY-MM-DD HH:mm' };
  else if (f.type === 'boolean')
    def = {
      type: 'boolean' as const,
      ...base,
      trueLabel: f.trueLabel || '是',
      falseLabel: f.falseLabel || '否',
    };
  else if (f.type === 'enum') {
    const opts = (f.options ?? []).filter((o) => o.value && o.label);
    if (opts.length === 0) {
      ElMessage.error('enum 至少需要一个选项 (value + label 都要填)');
      return;
    }
    def = { type: 'enum' as const, ...base, options: opts };
  } else if (f.type === 'image') {
    const accept =
      f.accept && f.accept.length > 0 ? f.accept : ['image/svg+xml', 'image/png', 'image/jpeg'];
    def = { type: 'image' as const, ...base, accept };
  } else def = { type: 'array' as const, ...base };

  if (dialogMode.value === 'add') store.addField(f.key, def);
  else store.editField(f.key, def);
  dialogOpen.value = false;
}

async function remove(key: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除变量 "${key}"？模板中绑定到该字段的元素将变为未绑定状态。`,
      '删除变量',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        center: true,
      },
    );
    store.removeField(key);
  } catch {
    /* user cancelled */
  }
}
</script>

<template>
  <div class="tp-section-top field-mgr">
    <div class="tp-sub-head">
      <span class="tp-sub-title">变量 · 共 {{ store.fieldDefs.length }} 个</span>
      <button class="tp-sub-add" title="添加变量" @click="openAdd">
        <Plus :size="14" :stroke-width="2" />
      </button>
    </div>
    <div v-if="store.fieldDefs.length > 5" class="fm-search">
      <Search :size="13" :stroke-width="2" />
      <input type="text" v-model="searchQuery" placeholder="搜索变量名或显示名…" />
    </div>
    <div class="fm-body">
      <div v-if="filteredFields.length === 0 && store.fieldDefs.length === 0" class="empty">
        尚未声明变量<br />点击 + 添加
      </div>
      <div v-else-if="filteredFields.length === 0" class="empty">
        没有匹配 "{{ searchQuery }}" 的变量
      </div>
      <div
        v-for="{ key, def } in filteredFields"
        :key="key"
        class="field-card"
        :class="{ bound: store.usedFieldKeys.has(key) }"
        :title="store.usedFieldKeys.has(key) ? '已绑定' : '未绑定'"
      >
        <div class="card-row">
          <span class="k">{{ key }}</span>
          <span class="t">{{ def.type }}</span>
        </div>
        <div class="card-row card-row-sub">
          <span class="l">{{ def.label }}</span>
          <span v-if="def.required" class="req">必填</span>
          <button class="action edit" @click="openEdit(key)" title="编辑变量">
            <Pencil :size="13" :stroke-width="2" />
          </button>
          <button class="action del" @click="remove(key)" title="删除变量">
            <Trash2 :size="13" :stroke-width="2" />
          </button>
        </div>
      </div>
    </div>

    <ElDialog
      v-model="dialogOpen"
      :title="dialogMode === 'edit' ? '编辑变量' : '添加变量'"
      width="420px"
    >
      <ElForm label-position="top">
        <ElFormItem label="key (英文/拼音)">
          <ElInput v-model="form.key" :disabled="dialogMode === 'edit'" />
        </ElFormItem>
        <ElFormItem label="label (中文显示名)"><ElInput v-model="form.label" /></ElFormItem>
        <ElFormItem label="类型">
          <ElSelect v-model="form.type">
            <ElOption label="文本 string" value="string" />
            <ElOption label="数字 number" value="number" />
            <ElOption label="日期 date" value="date" />
            <ElOption label="日期时间 datetime" value="datetime" />
            <ElOption label="布尔 boolean" value="boolean" />
            <ElOption label="枚举 enum" value="enum" />
            <ElOption label="图片 image" value="image" />
            <ElOption label="数组 array" value="array" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem v-if="form.type === 'string'" label="最大长度">
          <ElInput v-model.number="form.maxLength" type="number" />
        </ElFormItem>
        <ElFormItem v-if="form.type === 'number'" label="千分位显示">
          <ElCheckbox v-model="form.thousands" />
        </ElFormItem>
        <ElFormItem v-if="form.type === 'date' || form.type === 'datetime'" label="格式">
          <ElInput
            v-model="form.format"
            :placeholder="form.type === 'datetime' ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD'"
          />
        </ElFormItem>
        <template v-if="form.type === 'boolean'">
          <ElFormItem label="true 显示文案"
            ><ElInput v-model="form.trueLabel" placeholder="是"
          /></ElFormItem>
          <ElFormItem label="false 显示文案"
            ><ElInput v-model="form.falseLabel" placeholder="否"
          /></ElFormItem>
        </template>
        <template v-if="form.type === 'enum'">
          <ElFormItem label="选项">
            <div v-for="(o, i) in form.options || []" :key="i" class="enum-row">
              <ElInput v-model="o.value" placeholder="value" style="width: 40%" />
              <ElInput v-model="o.label" placeholder="label" style="width: 40%; margin-left: 8px" />
              <ElButton link type="danger" @click="removeOptionRow(i)" style="margin-left: 8px"
                >×</ElButton
              >
            </div>
            <ElButton link @click="addOptionRow" style="margin-top: 6px">+ 添加选项</ElButton>
          </ElFormItem>
        </template>
        <ElFormItem v-if="form.type === 'image'" label="允许格式">
          <ElCheckbox
            :model-value="form.accept?.includes('image/svg+xml') ?? true"
            @change="(v) => (form.accept = toggleAcc(form.accept, 'image/svg+xml', !!v))"
            >SVG</ElCheckbox
          >
          <ElCheckbox
            :model-value="form.accept?.includes('image/png') ?? true"
            @change="(v) => (form.accept = toggleAcc(form.accept, 'image/png', !!v))"
            >PNG</ElCheckbox
          >
          <ElCheckbox
            :model-value="form.accept?.includes('image/jpeg') ?? true"
            @change="(v) => (form.accept = toggleAcc(form.accept, 'image/jpeg', !!v))"
            >JPG</ElCheckbox
          >
        </ElFormItem>

        <ElFormItem label="示例值"><ElInput v-model="form.example" /></ElFormItem>

        <ElButton type="primary" style="width: 100%" @click="submit">
          {{ dialogMode === 'edit' ? '保存' : '添加' }}
        </ElButton>
      </ElForm>
    </ElDialog>
  </div>
</template>

<style scoped>
.field-mgr {
  min-height: 0;
}
.fm-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 12px;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--tp-ink-faint);
  font-size: 12px;
  line-height: 1.7;
}
/* Default = unbound = light gray */
.field-card {
  margin-bottom: 6px;
  padding: 8px 10px;
  border-radius: var(--tp-radius-item, 8px);
  border: 1px solid var(--tp-line-strong);
  background: #f5f5f6;
  font-size: 12px;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}
.field-card:hover {
  border-color: var(--tp-accent);
  background: var(--tp-field-bg);
}

/* Bound = light green */
.field-card.bound {
  background: #e6f5ec;
  border-color: #9bd5b3;
}
.card-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.card-row-sub {
  margin-top: 2px;
}
.k {
  font-family: ui-monospace, monospace;
  font-weight: 600;
  color: var(--tp-ink);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t {
  font-size: 10px;
  background: var(--tp-accent-bg);
  color: var(--tp-accent-ink);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}
.l {
  flex: 1;
  min-width: 0;
  color: var(--tp-ink-soft);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.req {
  font-size: 10px;
  color: var(--tp-accent-ink);
  background: var(--tp-accent-bg);
  padding: 0 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.action {
  border: none;
  background: transparent;
  color: var(--tp-ink-faint);
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.action:hover {
  background: var(--tp-field-bg);
  color: var(--tp-accent-ink);
}
.action.del:hover {
  background: rgba(217, 79, 79, 0.1);
  color: #d94f4f;
}
.enum-row {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}
.fm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 4px;
  color: var(--tp-ink-faint);
}
.fm-search input {
  flex: 1;
  border: 1px solid var(--tp-line-strong);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--tp-panel);
  color: var(--tp-ink);
  outline: none;
}
.fm-search input:focus {
  border-color: var(--tp-accent);
}
</style>
