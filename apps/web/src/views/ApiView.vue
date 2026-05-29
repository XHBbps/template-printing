<script setup lang="ts">
import { ref, reactive, watch, onMounted, computed, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Code as CodeIcon,
  Copy,
  Plus,
} from 'lucide-vue-next';
// eslint-disable-next-line import/no-unresolved
import { apiFetch } from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const auth = useAuthStore();
const isInternal = computed(() => auth.user?.isInternal ?? false);

/* ============================================================
 * 顶部 tab：凭证 / 文档(默认) / 模板字段
 * ========================================================== */
type TopTab = 'tokens' | 'docs' | 'schemas';
const activeTab = ref<TopTab>('docs');

// /me/api-tokens → /api?to=tokens 重定向；旧锚点 templates → schemas
onMounted(() => {
  const to = route.query.to;
  if (to === 'tokens') activeTab.value = 'tokens';
  else if (to === 'templates' || to === 'schemas') activeTab.value = 'schemas';
});

/* ============================================================
 * 模板字段（Schemas tab）
 * ========================================================== */
interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

interface TemplateDetail extends TemplateListItem {
  data: {
    schema?: { fields?: Record<string, FieldDef> } | Record<string, FieldDef>;
  };
}

interface FieldDef {
  type: string;
  label?: string;
  required?: boolean;
  example?: unknown;
  options?: Array<{ value: string; label: string }>;
}

const templates = ref<TemplateListItem[]>([]);
const detailCache = ref<Record<string, TemplateDetail>>({});
const expanded = ref<Record<string, boolean>>({});
// 改为按 tab 懒拉：未首次拉取时不应让 schemas tab 永远转圈，故初值 false；
// ensureTemplates 首次触发时自行置 true（见下）。
const loading = ref(false);

/* ============================================================
 * 凭证（Tokens tab）— 合并自 ApiTokensView
 * ========================================================== */
interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
const tokens = ref<TokenSummary[]>([]);
// 同 loading：按 tab 懒拉，未首次拉取前不应转圈，故初值 false；refreshTokens 触发时自行置 true。
const tokensLoading = ref(false);
const createDialogOpen = ref(false);
const newName = ref('');
const creating = ref(false);
const plaintextDialogOpen = ref(false);
const newPlaintext = ref('');

const activeTokenCount = computed(() => tokens.value.filter((t) => !t.revokedAt).length);

async function refreshTokens(): Promise<void> {
  tokensLoading.value = true;
  try {
    const r = await apiFetch<{ items: TokenSummary[] }>('/users/me/api-tokens');
    tokens.value = r.items;
  } finally {
    tokensLoading.value = false;
  }
}

async function doCreateToken(): Promise<void> {
  if (!newName.value.trim()) {
    ElMessage.warning('请输入 token 名称');
    return;
  }
  creating.value = true;
  try {
    const r = await apiFetch<{ plaintext: string; record: TokenSummary }>('/users/me/api-tokens', {
      method: 'POST',
      body: JSON.stringify({ name: newName.value.trim() }),
    });
    createDialogOpen.value = false;
    newName.value = '';
    newPlaintext.value = r.plaintext;
    plaintextDialogOpen.value = true;
    await refreshTokens();
  } catch (e) {
    ElMessage.error(`创建失败：${(e as Error).message}`);
  } finally {
    creating.value = false;
  }
}

// ---- Revoke confirm dialog ----
const revokeDialogOpen = ref(false);
const revokeTarget = ref<TokenSummary | null>(null);
const revoking = ref(false);

function doRevokeToken(t: TokenSummary): void {
  revokeTarget.value = t;
  revokeDialogOpen.value = true;
}

async function confirmRevoke(): Promise<void> {
  const t = revokeTarget.value;
  if (!t) return;
  revoking.value = true;
  try {
    await apiFetch(`/users/me/api-tokens/${t.id}`, { method: 'DELETE' });
    ElMessage.success('已吊销');
    revokeDialogOpen.value = false;
    await refreshTokens();
  } catch (e) {
    ElMessage.error(`吊销失败：${(e as Error).message}`);
  } finally {
    revoking.value = false;
  }
}

async function copyText(text: string, label = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
}

function formatAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '未使用';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

async function ensureDetail(id: string): Promise<void> {
  if (detailCache.value[id]) return;
  try {
    const d = await apiFetch<TemplateDetail>(`/templates/${id}`);
    detailCache.value[id] = d;
  } catch (e) {
    ElMessage.error(`加载模板详情失败：${(e as Error).message}`);
  }
}

async function toggle(id: string): Promise<void> {
  expanded.value[id] = !expanded.value[id];
  if (expanded.value[id]) await ensureDetail(id);
}

function fieldsOf(id: string): Array<{ key: string; def: FieldDef }> {
  const d = detailCache.value[id];
  if (!d?.data?.schema) return [];
  const s = d.data.schema as Record<string, unknown>;
  const fieldsMap = (s.fields && typeof s.fields === 'object' ? s.fields : s) as Record<
    string,
    FieldDef
  >;
  return Object.entries(fieldsMap)
    .filter(([, v]) => v && typeof v === 'object' && (v as FieldDef).type)
    .map(([key, def]) => ({ key, def }));
}

// 按 tab 懒拉：tokens / schemas 各只拉一次，docs 默认不拉。
let tokensLoaded = false;
let templatesLoaded = false;

async function ensureTokens(): Promise<void> {
  if (tokensLoaded) return;
  tokensLoaded = true;
  await refreshTokens();
}

async function ensureTemplates(): Promise<void> {
  if (templatesLoaded) return;
  templatesLoaded = true;
  loading.value = true;
  try {
    // 服务端分页后 /templates 返 { items, total, ... }；API 参考页取首段（上限 100）即可
    const res = await apiFetch<{ items: TemplateListItem[] }>('/templates?limit=100');
    templates.value = res.items;
  } finally {
    loading.value = false;
  }
}

// 仅对初始 activeTab 对应数据 ensure（route.query.to 已在上方 onMounted 里设好 activeTab）
onMounted(() => {
  if (activeTab.value === 'tokens') void ensureTokens();
  else if (activeTab.value === 'schemas') void ensureTemplates();
});

// 切到 tokens / schemas 时按需懒拉（守卫保证不重拉）
watch(activeTab, (t) => {
  if (t === 'tokens') void ensureTokens();
  else if (t === 'schemas') void ensureTemplates();
});

const hasTemplates = computed(() => templates.value.length > 0);

/* ============================================================
 * 文档（Docs tab）：TOC + 接口手风琴
 * ========================================================== */
interface TocItem {
  id: string;
  num: string;
  title: string;
  en: string;
}
const docSections: TocItem[] = [
  { id: 'overview', num: '01', title: '概览', en: 'Overview' },
  { id: 'auth', num: '02', title: '鉴权', en: 'Auth' },
  { id: 'endpoints', num: '03', title: '接口列表', en: 'Endpoints' },
];

const activeToc = ref<string>('overview');

function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// IntersectionObserver — 高亮当前可见 section（仅文档 tab 内的三个主章节）
let observer: IntersectionObserver | null = null;
onMounted(() => {
  void nextTick(() => {
    const scrollRoot = document.querySelector('.view-root > .page-body');
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) activeToc.value = visible[0].target.id;
      },
      { root: scrollRoot, rootMargin: '-72px 0px -60% 0px', threshold: 0 },
    );
    for (const s of docSections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
  });
});
onBeforeUnmount(() => {
  observer?.disconnect();
});

/* ---- 接口手风琴：单开模式，默认展开第一个 ---- */
type Lang = 'curl' | 'node' | 'python';
interface SpecRow {
  code: string;
  type?: string;
  req?: boolean;
  desc: string;
}
interface Endpoint {
  id: string;
  method: 'post' | 'get';
  path: string;
  desc: string;
  intro: string;
  reqHeaders?: SpecRow[];
  reqTitle?: string;
  reqRows?: SpecRow[];
  respRows?: SpecRow[];
  respExample?: string;
  behavior?: string[];
  callbackText?: string;
  callbackExample?: string;
  errors?: Array<{ http: string; code: string; reason: string }>;
  samples?: Partial<Record<Lang, string>>;
}

const endpoints: Endpoint[] = [
  {
    id: 'ep-enqueue',
    method: 'post',
    path: '/api/render',
    desc: '入队渲染（异步）',
    intro:
      '把渲染任务入队，立即返回 jobId。完成时通过 callbackUrl 收 webhook，或主动轮询 GET 接口。',
    reqHeaders: [
      { code: 'Authorization', req: true, desc: 'Bearer <token>' },
      { code: 'Content-Type', req: true, desc: 'application/json' },
      { code: 'X-Idempotency-Key', req: false, desc: '幂等键，避免重复入队（推荐）' },
    ],
    reqTitle: '请求体 · Body',
    reqRows: [
      {
        code: 'templateId',
        type: 'string (UUID)',
        req: true,
        desc: '模板 ID（在「模板中心」打开模板时 URL 上有）',
      },
      {
        code: 'data',
        type: 'object',
        req: false,
        desc: '业务字段 map，key 对应该版本模板 schema.fields；默认 {}',
      },
      { code: 'formats', type: 'string[]', req: false, desc: '导出格式，默认 ["pdf"]，可加 "png"' },
      { code: 'callbackUrl', type: 'string', req: false, desc: '完成时回调地址' },
      {
        code: 'version',
        type: 'number',
        req: false,
        desc: '指定渲染的已发布版本号；不传=最新已发布版',
      },
    ],
    respRows: [
      { code: 'jobId', type: 'string (UUID)', desc: '渲染任务 ID，后续查询 / callback 中关联' },
      { code: 'status', type: 'string', desc: '初始固定为 "pending"' },
    ],
    respExample: `{
  "jobId": "abc-123-...",
  "status": "pending"
}`,
    callbackText: '渲染完成（成功 / 失败）后，平台 POST 以下结构到 callbackUrl：',
    callbackExample: `{
  "jobId": "abc-123-...",
  "status": "done" | "failed",
  "pdfUrl": "/uploads/render/abc-123.pdf" | null,
  "pngUrl": "/uploads/render/abc-123.png" | null,
  "errorMsg": null | "..."
}`,
    errors: [
      {
        http: '400',
        code: 'BAD_REQUEST',
        reason: '请求体校验失败（templateId / data 等格式问题）',
      },
      { http: '401', code: 'UNAUTHORIZED', reason: '无 Bearer / token 失效 / cookie 无效' },
      { http: '404', code: 'template_not_found', reason: 'templateId 不存在或当前用户无权限' },
      {
        http: '400',
        code: 'no_published_version',
        reason: '该模板尚无已发布版本（请先在设计器发布）',
      },
      {
        http: '404',
        code: 'template_version_not_found',
        reason: '指定的 version 不存在或不属于该模板',
      },
    ],
    samples: {
      curl: `curl 'https://api.yangli.local/api/render' \\
  -H 'Authorization: Bearer tpkn_a1b2c3d4...' \\
  -H 'Content-Type: application/json' \\
  -d '{"templateId":"e0798b17-...","data":{"group":"扬机"},"formats":["pdf"],"version":2}'`,
      node: `const res = await fetch('https://api.yangli.local/api/render', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer tpkn_a1b2c3d4...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    templateId: 'e0798b17-...',
    data: { group: '扬机', material_num: '10100' },
    formats: ['pdf'],
    callbackUrl: 'https://your-server.com/print-callback',
    version: 2,
  }),
});
const { jobId } = await res.json();`,
      python: `import requests

res = requests.post(
    'https://api.yangli.local/api/render',
    headers={'Authorization': 'Bearer tpkn_a1b2c3d4...'},
    json={
        'templateId': 'e0798b17-...',
        'data': {'group': '扬机', 'material_num': '10100'},
        'formats': ['pdf'],
        'callbackUrl': 'https://your-server.com/print-callback',
        'version': 2,
    },
)
print(res.json()['jobId'])`,
    },
  },
  {
    id: 'ep-get-job',
    method: 'get',
    path: '/api/render/:jobId',
    desc: '轮询任务状态',
    intro: '查询渲染任务当前状态。对 webhook 不便接入的调用方提供轮询路径。',
    reqHeaders: [{ code: 'Authorization', req: true, desc: 'Bearer <token>' }],
    reqTitle: '路径参数 · Path',
    reqRows: [{ code: 'jobId', type: 'string (UUID)', req: true, desc: 'POST 时返回的任务 ID' }],
    respRows: [
      { code: 'status', type: 'string', desc: 'pending / processing / done / failed' },
      { code: 'pdfUrl', type: 'string | null', desc: '完成后才有，相对路径 /uploads/render/...' },
      { code: 'errorMsg', type: 'string | null', desc: '失败时含错误描述' },
      {
        code: 'templateVersion',
        type: 'number | null',
        desc: '本次渲染锁定的版本号（草稿渲染为 null）',
      },
    ],
    respExample: `{
  "jobId": "abc-123-...",
  "status": "done",
  "pdfUrl": "/uploads/render/abc-123.pdf",
  "pngUrl": null,
  "errorMsg": null,
  "templateVersion": 2,
  "createdAt": "2026-05-24T10:30:00Z",
  "completedAt": "2026-05-24T10:30:02Z"
}`,
    errors: [
      { http: '401', code: 'UNAUTHORIZED', reason: '无 Bearer / token 失效 / cookie 无效' },
      { http: '404', code: 'job_not_found', reason: 'jobId 不存在或当前用户无权限' },
    ],
    samples: {
      curl: `curl 'https://api.yangli.local/api/render/abc-123-...' \\
  -H 'Authorization: Bearer tpkn_a1b2c3d4...'`,
      node: `const res = await fetch('https://api.yangli.local/api/render/abc-123-...', {
  headers: { Authorization: 'Bearer tpkn_a1b2c3d4...' },
});
const job = await res.json();
console.log(job.status, job.pdfUrl);`,
      python: `import requests

res = requests.get(
    'https://api.yangli.local/api/render/abc-123-...',
    headers={'Authorization': 'Bearer tpkn_a1b2c3d4...'},
)
job = res.json()
print(job['status'], job['pdfUrl'])`,
    },
  },
  {
    id: 'ep-list-jobs',
    method: 'get',
    path: '/api/render/jobs',
    desc: '列出渲染任务（分页）',
    intro:
      '分页查询渲染任务列表。admin / emergency_admin 看全部；普通用户 / API Token 仅看自己模板的任务。',
    reqHeaders: [{ code: 'Authorization', req: true, desc: 'Bearer <token>' }],
    reqTitle: '查询参数 · Query',
    reqRows: [
      { code: 'page', type: 'number', req: false, desc: '页码，默认 1' },
      { code: 'pageSize', type: 'number', req: false, desc: '每页条数，默认 20，上限 100' },
      {
        code: 'status',
        type: 'string',
        req: false,
        desc: '按状态过滤：pending / processing / done / failed',
      },
      { code: 'source', type: 'string', req: false, desc: '按来源过滤：api / bot / bitable' },
      { code: 'templateName', type: 'string', req: false, desc: '按模板名模糊搜索' },
    ],
    respRows: [
      { code: 'items', type: 'object[]', desc: '任务列表，单项字段见下方示例' },
      { code: 'total', type: 'number', desc: '匹配的总条数' },
      { code: 'page', type: 'number', desc: '当前页码' },
      { code: 'pageSize', type: 'number', desc: '每页条数' },
    ],
    respExample: `{
  "items": [
    {
      "id": "abc-123-...",
      "templateId": "e0798b17-...",
      "templateName": "扬力出门证",
      "status": "done",
      "source": "api",
      "createdAt": "2026-05-29T10:30:00Z",
      "completedAt": "2026-05-29T10:30:02Z",
      "cleanedAt": null,
      "durationMs": 2010,
      "pdfUrl": "/uploads/render/abc-123.pdf",
      "pngUrl": null,
      "errorMsg": null
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}`,
    errors: [
      { http: '400', code: 'BAD_REQUEST', reason: 'page / pageSize 非法（如 ?page=abc）' },
      { http: '401', code: 'UNAUTHORIZED', reason: '无 Bearer / token 失效 / cookie 无效' },
    ],
    samples: {
      curl: `curl 'https://api.yangli.local/api/render/jobs?page=1&pageSize=20&source=api' \\
  -H 'Authorization: Bearer tpkn_a1b2c3d4...'`,
      node: `const res = await fetch('https://api.yangli.local/api/render/jobs?page=1&pageSize=20', {
  headers: { Authorization: 'Bearer tpkn_a1b2c3d4...' },
});
const { items, total } = await res.json();
console.log(total, items.length);`,
      python: `import requests

res = requests.get(
    'https://api.yangli.local/api/render/jobs',
    params={'page': 1, 'pageSize': 20, 'source': 'api'},
    headers={'Authorization': 'Bearer tpkn_a1b2c3d4...'},
)
body = res.json()
print(body['total'], len(body['items']))`,
    },
  },
  {
    id: 'ep-lark-trigger',
    method: 'post',
    path: '/lark/print-trigger',
    desc: '飞书 webhook 入口',
    intro:
      '飞书多维表格按钮自动化的 webhook 入口。无需登录，通过 body 内 verificationToken 校验调用方（与 .env 里 LARK_BITABLE_VERIFICATION_TOKEN 对齐）。详细接入见 examples/lark-bitable/README.md。',
    reqHeaders: [{ code: 'Content-Type', req: true, desc: 'application/json' }],
    reqTitle: '请求体 · Body',
    reqRows: [
      { code: 'verificationToken', type: 'string', req: true, desc: '服务端配置的共享 token' },
      { code: 'templateId', type: 'string (UUID)', req: true, desc: '模板 ID' },
      {
        code: 'data',
        type: 'object',
        req: false,
        desc: '业务字段 map（从飞书自动化变量 {{ 字段.xxx }} 引用）',
      },
      { code: 'lark.appToken', type: 'string', req: true, desc: '多维表格 app_token' },
      { code: 'lark.tableId', type: 'string', req: true, desc: '表 ID' },
      { code: 'lark.recordId', type: 'string', req: true, desc: '当前行 record_id' },
      { code: 'lark.statusField', type: 'string', req: true, desc: '"打印状态" 单选列的列名' },
      { code: 'lark.attachmentField', type: 'string', req: true, desc: '"PDF 附件" 附件列的列名' },
      {
        code: 'version',
        type: 'number',
        req: false,
        desc: '指定渲染的已发布版本号；不传=最新已发布版',
      },
    ],
    behavior: [
      '立即落 LarkPrintRequest 记录 + 入队渲染',
      '异步把多维表格 statusField 改为「处理中」',
      '渲染完成 → 上传 PDF 到飞书云空间 → 写回 attachmentField + statusField =「已完成」',
      '失败 → statusField =「失败」',
    ],
    errors: [
      { http: '401', code: 'UNAUTHORIZED', reason: 'verificationToken 缺失或与服务端不一致' },
      { http: '404', code: 'template_not_found', reason: 'templateId 不存在' },
    ],
    samples: {
      curl: `curl 'https://api.yangli.local/lark/print-trigger' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "verificationToken": "<shared>",
    "templateId": "e0798b17-...",
    "data": { "group": "扬机" },
    "lark": {
      "appToken": "bascn...",
      "tableId": "tbl...",
      "recordId": "rec...",
      "statusField": "打印状态",
      "attachmentField": "PDF 附件"
    }
  }'`,
    },
  },
];

const openEp = ref<string>('ep-enqueue');
function toggleEp(id: string): void {
  openEp.value = openEp.value === id ? '' : id;
}
function openEndpoint(id: string): void {
  activeTab.value = 'docs';
  openEp.value = id;
  void nextTick(() => jumpTo(id));
}

// 每个接口的内部 sub-tab（请求 / 响应 / 回调 / 错误 / 示例）
const epTab = reactive<Record<string, string>>({});
function tabsOf(ep: Endpoint): string[] {
  const t: string[] = ['请求'];
  if (ep.respRows || ep.respExample || ep.behavior) t.push('响应');
  if (ep.callbackExample) t.push('回调');
  if (ep.errors) t.push('错误');
  if (ep.samples) t.push('示例');
  return t;
}
function tabOf(ep: Endpoint): string {
  return epTab[ep.id] ?? '请求';
}
function setTab(ep: Endpoint, key: string): void {
  epTab[ep.id] = key;
}

// 代码语言切换
const epLang = reactive<Record<string, Lang>>({});
const langLabel: Record<Lang, string> = { curl: 'cURL', node: 'Node.js', python: 'Python' };
function langsOf(ep: Endpoint): Lang[] {
  return (['curl', 'node', 'python'] as Lang[]).filter((l) => ep.samples?.[l]);
}
function langOf(ep: Endpoint): Lang {
  const cur = epLang[ep.id];
  const avail = langsOf(ep);
  return cur && avail.includes(cur) ? cur : avail[0];
}
function setLang(ep: Endpoint, l: Lang): void {
  epLang[ep.id] = l;
}
function copySample(ep: Endpoint): void {
  const code = ep.samples?.[langOf(ep)];
  if (code) void copyText(code, '已复制代码');
}
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><CodeIcon :size="20" :stroke-width="1.5" /></span>
        API
      </div>
      <div class="page-sub">DEVELOPER · REFERENCE</div>
      <div class="page-bar-spacer"></div>
    </header>

    <!-- ============ 顶部 tab ============ -->
    <nav class="api-tabs">
      <a
        v-if="isInternal"
        class="tab"
        :class="{ active: activeTab === 'tokens' }"
        @click="activeTab = 'tokens'"
      >
        凭证 <span class="en">Tokens</span>
      </a>
      <a class="tab" :class="{ active: activeTab === 'docs' }" @click="activeTab = 'docs'">
        文档 <span class="en">Docs</span>
      </a>
      <a class="tab" :class="{ active: activeTab === 'schemas' }" @click="activeTab = 'schemas'">
        模板字段 <span class="en">Schemas</span>
      </a>
    </nav>

    <!-- ============ Body ============ -->
    <div class="page-body">
      <!-- ====================== 文档 ====================== -->
      <div v-show="activeTab === 'docs'" class="docs-layout">
        <!-- TOC -->
        <aside class="toc">
          <div class="toc-head">On this page</div>
          <nav>
            <a
              v-for="s in docSections"
              :key="s.id"
              :class="{ active: activeToc === s.id }"
              @click.prevent="jumpTo(s.id)"
            >
              {{ s.title }}
            </a>
            <a
              v-for="ep in endpoints"
              :key="ep.id"
              class="sub"
              :class="{ active: openEp === ep.id }"
              @click.prevent="openEndpoint(ep.id)"
            >
              {{ ep.method.toUpperCase() }} {{ ep.path }}
            </a>
          </nav>
        </aside>

        <!-- Docs -->
        <article class="docs">
          <h1>API 文档</h1>
          <div class="lede">REST · BEARER TOKEN · 飞书 WEBHOOK</div>

          <!-- 概览 -->
          <section id="overview">
            <div class="sec-head">
              <span class="num">01</span>
              <span class="red-square"></span>
              <h2>概览</h2>
              <span class="en">Overview</span>
              <span class="rule"></span>
            </div>
            <p>
              以 REST 调用 <code>/api/render</code> 把渲染任务入队，完成时通过 callbackUrl 收
              webhook 或主动轮询。所有接口默认 JSON。
              渲染针对模板的已发布版本：默认最新已发布版，可在请求里指定
              <code>version</code> 渲染历史版本。
            </p>
          </section>

          <!-- 鉴权 -->
          <section id="auth">
            <div class="sec-head">
              <span class="num">02</span>
              <span class="red-square"></span>
              <h2>鉴权</h2>
              <span class="en">Auth</span>
              <span class="rule"></span>
            </div>

            <div class="auth-quick">
              <div class="l">Bearer Token</div>
              <p>每个请求加请求头。Token 在「凭证」页创建，仅显示一次。</p>
              <div class="code">Authorization: Bearer tpkn_a1b2c3d4e5f60718a9bcdef0123456789</div>

              <details>
                <summary>飞书 webhook 怎么做？</summary>
                <p>
                  飞书后台事件订阅 / 卡片回调 / 自动化 webhook 在 body 内传一个共享
                  <code>verificationToken</code>，服务端从
                  <code>.env</code> 读取并校验，不需要用户级 token。
                </p>
              </details>
            </div>
          </section>

          <!-- 接口列表（手风琴） -->
          <section id="endpoints">
            <div class="sec-head">
              <span class="num">03</span>
              <span class="red-square"></span>
              <h2>接口列表</h2>
              <span class="en">Endpoints</span>
              <span class="rule"></span>
            </div>

            <div class="endpoints">
              <div
                v-for="ep in endpoints"
                :id="ep.id"
                :key="ep.id"
                class="ep"
                :class="{ open: openEp === ep.id }"
              >
                <div class="ep-head" @click="toggleEp(ep.id)">
                  <span class="method" :class="ep.method">{{ ep.method.toUpperCase() }}</span>
                  <span class="ep-path">{{ ep.path }}</span>
                  <span class="ep-desc">{{ ep.desc }}</span>
                  <span class="chev"><ChevronDown :size="16" :stroke-width="1.6" /></span>
                </div>

                <div v-show="openEp === ep.id" class="ep-body">
                  <!-- 内部 sub-tabs -->
                  <div class="ep-tabs">
                    <span
                      v-for="(t, i) in tabsOf(ep)"
                      :key="t"
                      class="ep-tab"
                      :class="{ active: tabOf(ep) === t }"
                      @click="setTab(ep, t)"
                    >
                      {{ t }}
                      <span v-if="t !== '示例'" class="num">{{
                        String(i + 1).padStart(2, '0')
                      }}</span>
                    </span>
                  </div>

                  <!-- 请求 -->
                  <div v-if="tabOf(ep) === '请求'" class="ep-pane">
                    <p class="pane-intro">{{ ep.intro }}</p>

                    <template v-if="ep.reqHeaders">
                      <div class="pane-label">请求头 · Headers</div>
                      <table class="spec">
                        <thead>
                          <tr>
                            <th>字段</th>
                            <th class="th-req">必</th>
                            <th>说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="h in ep.reqHeaders" :key="h.code">
                            <td class="code">{{ h.code }}</td>
                            <td class="req">
                              <span :class="h.req ? 'y' : 'n'">{{ h.req ? '●' : '○' }}</span>
                            </td>
                            <td>{{ h.desc }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </template>

                    <template v-if="ep.reqRows">
                      <div class="pane-label">{{ ep.reqTitle }}</div>
                      <table class="spec">
                        <thead>
                          <tr>
                            <th>字段</th>
                            <th>类型</th>
                            <th class="th-req">必</th>
                            <th>说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="r in ep.reqRows" :key="r.code">
                            <td class="code">{{ r.code }}</td>
                            <td class="type">{{ r.type }}</td>
                            <td class="req">
                              <span :class="r.req ? 'y' : 'n'">{{ r.req ? '●' : '○' }}</span>
                            </td>
                            <td>{{ r.desc }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </template>
                  </div>

                  <!-- 响应 -->
                  <div v-else-if="tabOf(ep) === '响应'" class="ep-pane">
                    <table v-if="ep.respRows" class="spec">
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>类型</th>
                          <th>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="r in ep.respRows" :key="r.code">
                          <td class="code">{{ r.code }}</td>
                          <td class="type">{{ r.type }}</td>
                          <td>{{ r.desc }}</td>
                        </tr>
                      </tbody>
                    </table>

                    <div v-if="ep.respExample" class="code-wrap" :class="{ spaced: ep.respRows }">
                      <div class="code-tabs">
                        <span class="code-tab static">JSON · 200</span>
                        <div class="code-actions">
                          <button @click="copyText(ep.respExample, '已复制')">COPY</button>
                        </div>
                      </div>
                      <pre class="code">{{ ep.respExample }}</pre>
                    </div>

                    <ul v-if="ep.behavior" class="behavior">
                      <li v-for="(b, i) in ep.behavior" :key="i">{{ b }}</li>
                    </ul>
                  </div>

                  <!-- 回调 -->
                  <div v-else-if="tabOf(ep) === '回调'" class="ep-pane">
                    <p v-if="ep.callbackText" class="pane-intro">{{ ep.callbackText }}</p>
                    <div v-if="ep.callbackExample" class="code-wrap">
                      <div class="code-tabs">
                        <span class="code-tab static">Webhook payload</span>
                        <div class="code-actions">
                          <button @click="copyText(ep.callbackExample, '已复制')">COPY</button>
                        </div>
                      </div>
                      <pre class="code">{{ ep.callbackExample }}</pre>
                    </div>
                  </div>

                  <!-- 错误 -->
                  <div v-else-if="tabOf(ep) === '错误'" class="ep-pane">
                    <table class="spec">
                      <thead>
                        <tr>
                          <th>HTTP</th>
                          <th>错误</th>
                          <th>原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="e in ep.errors" :key="e.http">
                          <td class="code">{{ e.http }}</td>
                          <td class="type">{{ e.code }}</td>
                          <td>{{ e.reason }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <!-- 示例 -->
                  <div v-else-if="tabOf(ep) === '示例'" class="ep-pane">
                    <div class="code-wrap">
                      <div class="code-tabs">
                        <span
                          v-for="l in langsOf(ep)"
                          :key="l"
                          class="code-tab"
                          :class="{ active: langOf(ep) === l }"
                          @click="setLang(ep, l)"
                        >
                          {{ langLabel[l] }}
                        </span>
                        <div class="code-actions">
                          <button @click="copySample(ep)">COPY</button>
                        </div>
                      </div>
                      <pre class="code">{{ ep.samples?.[langOf(ep)] }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </article>
      </div>

      <!-- ====================== 凭证 ====================== -->
      <div v-show="activeTab === 'tokens'" class="tab-pane">
        <div class="section-head">
          <h2 class="pane-title">我的 Token <span class="han">· Bearer Credentials</span></h2>
          <button
            v-if="isInternal"
            class="btn btn-primary sm"
            type="button"
            @click="createDialogOpen = true"
          >
            <span class="ico"><Plus :size="14" :stroke-width="1.5" /></span>
            创建 Token
          </button>
        </div>

        <div v-if="!isInternal" class="callout">
          <div class="cap">ACCESS · 访问限制</div>
          <div class="title">仅内部账号可使用 API</div>
          <div class="desc">外部账号暂不支持创建 API Token，如需接入请联系管理员。</div>
        </div>

        <template v-if="isInternal">
          <div class="callout">
            <div class="cap">SECURITY · 安全须知</div>
            <div class="title">明文只在创建时显示一次</div>
            <div class="desc">
              DB 中以 SHA-256 哈希存储；管理端点（GET/POST/DELETE 本表）仅接受 cookie 鉴权，避免
              token 自管理 token 的环。
            </div>
          </div>

          <div v-if="tokensLoading" class="card">
            <div class="empty-state"><div class="eyebrow">Loading · 加载中</div></div>
          </div>
          <div v-else-if="tokens.length === 0" class="card">
            <div class="empty-state">
              <div class="eyebrow">No tokens · 暂无凭证</div>
              <div class="hint">FORMAT · tpkn_•••••• (32 hex)</div>
            </div>
          </div>
          <div v-else class="card">
            <div class="card-body flush">
              <table class="tokens-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>前缀</th>
                    <th>状态</th>
                    <th>最近使用</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in tokens" :key="t.id" :class="{ revoked: !!t.revokedAt }">
                    <td class="name">{{ t.name }}</td>
                    <td class="prefix">{{ t.prefix }}…</td>
                    <td>
                      <span v-if="t.revokedAt" class="pill idle">已吊销</span>
                      <span v-else class="pill ok">活跃</span>
                    </td>
                    <td class="prefix" :title="t.lastUsedAt ?? '未使用'">
                      {{ formatRelative(t.lastUsedAt) }}
                    </td>
                    <td class="prefix">{{ formatAbs(t.createdAt) }}</td>
                    <td>
                      <a
                        v-if="!t.revokedAt"
                        href="#"
                        class="revoke-link"
                        @click.prevent="doRevokeToken(t)"
                        >立即吊销</a
                      >
                      <span v-else class="muted">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="footer-meta">
              共 {{ tokens.length }} 个 token，{{ activeTokenCount }} 个活跃
            </div>
          </div>
        </template>
      </div>

      <!-- ====================== 模板字段 ====================== -->
      <div v-show="activeTab === 'schemas'" class="tab-pane">
        <h2 class="pane-title">模板字段 <span class="han">· Schemas</span></h2>
        <p class="pane-desc">
          下面列出当前账号可访问的模板及其自定义字段（<code>schema.fields</code>）。模板 ID
          在「模板中心」打开模板时也会出现在 URL 上。
        </p>

        <div v-if="loading" class="card">
          <div class="empty-state"><div class="eyebrow">Loading · 加载中</div></div>
        </div>
        <div v-else-if="!hasTemplates" class="card">
          <div class="empty-state">
            <div class="eyebrow">No templates · 暂无模板</div>
            <div class="msg">当前没有模板。请先在「模板中心」创建。</div>
          </div>
        </div>
        <div v-else class="card">
          <div class="card-body flush">
            <div class="tpl-row head">
              <div>模板</div>
              <div>自定义字段 (schema.fields)</div>
            </div>
            <template v-for="t in templates" :key="t.id">
              <div class="tpl-row" @click="toggle(t.id)">
                <div>
                  <div class="name">{{ t.name }}</div>
                  <div class="id">{{ t.id }}</div>
                </div>
                <div>
                  <a v-if="!detailCache[t.id]" class="expand">
                    <component
                      :is="expanded[t.id] ? ChevronDown : ChevronRight"
                      :size="12"
                      :stroke-width="2"
                    />
                    点击展开查看字段
                  </a>
                  <div v-else-if="fieldsOf(t.id).length === 0" class="field-hint">
                    （该模板无自定义字段，data 传 <code>{}</code> 即可）
                  </div>
                  <ul v-else class="field-list">
                    <li v-for="f in fieldsOf(t.id)" :key="f.key">
                      <div class="field-row">
                        <code class="field-key">{{ f.key }}</code>
                        <span class="field-type">{{ f.def.type }}</span>
                        <span v-if="f.def.required" class="field-required">必填</span>
                      </div>
                      <div v-if="f.def.label" class="field-meta">标签：{{ f.def.label }}</div>
                      <div v-if="f.def.example !== undefined" class="field-meta">
                        示例：<code>{{ String(f.def.example) }}</code>
                      </div>
                      <div v-if="f.def.options?.length" class="field-meta">
                        可选：{{ f.def.options.map((o) => o.value).join(' / ') }}
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
              <div v-if="expanded[t.id] && detailCache[t.id]" class="tpl-schema">
                <details>
                  <summary>完整 schema JSON</summary>
                  <pre class="code">{{
                    JSON.stringify(detailCache[t.id]?.data?.schema ?? {}, null, 2)
                  }}</pre>
                </details>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 吊销 Token confirm ============ -->
    <ConfirmDialog
      v-model="revokeDialogOpen"
      variant="destructive"
      title="吊销 Token"
      cap="REVOKE BEARER TOKEN"
      :body="
        revokeTarget
          ? `吊销 token「${revokeTarget.name}」？此操作不可恢复 — 任何使用此 token 的脚本将立即 401。`
          : ''
      "
      confirm-text="吊销"
      :loading="revoking"
      @confirm="confirmRevoke"
    />

    <!-- ============ 创建 Token dialog ============ -->
    <ElDialog v-model="createDialogOpen" title="创建新 Token" width="460px">
      <div class="dlg-body">
        <div class="field">
          <label class="lbl">名称 <span class="han">· Name</span></label>
          <input
            v-model="newName"
            type="text"
            placeholder="如：demo-bot / ci-script"
            maxlength="64"
            autofocus
          />
        </div>
        <p class="dlg-hint">
          建议起一个能识别用途的名字（哪个服务 / 哪个环境）。token
          一旦生成只会显示一次，请创建后立即复制保存。
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary sm" type="button" @click="createDialogOpen = false">
          取消
        </button>
        <button
          class="btn btn-primary sm"
          type="button"
          :disabled="creating"
          @click="doCreateToken"
        >
          {{ creating ? '生成中…' : '生成' }}
        </button>
      </template>
    </ElDialog>

    <!-- ============ 一次性明文 dialog ============ -->
    <ElDialog
      v-model="plaintextDialogOpen"
      title="Token 已创建"
      width="580px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="warn-box">
        <span class="ico"><AlertTriangle :size="18" :stroke-width="1.5" /></span>
        <div>
          <strong>请立即复制保存。</strong>
          关闭本对话框后，本平台再也不会以明文显示这个 token。忘记了只能创建新的。
        </div>
      </div>
      <div class="plaintext-row">
        <code class="plaintext">{{ newPlaintext }}</code>
        <button
          class="btn btn-secondary sm"
          type="button"
          @click="copyText(newPlaintext, '已复制到剪贴板')"
        >
          <span class="ico"><Copy :size="14" :stroke-width="1.5" /></span>
          复制
        </button>
      </div>
      <p class="dlg-hint">在请求里加请求头：<code>Authorization: Bearer &lt;此 token&gt;</code></p>
      <template #footer>
        <button
          class="btn btn-primary sm"
          type="button"
          @click="
            () => {
              plaintextDialogOpen = false;
              newPlaintext = '';
            }
          "
        >
          我已复制
        </button>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.view-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ============ 顶部 tab ============ */
.api-tabs {
  display: flex;
  align-items: stretch;
  background: var(--paper-white);
  border-bottom: 1px solid var(--stone);
  padding: 0 32px;
  flex-shrink: 0;
}
.api-tabs .tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 4px;
  margin-right: 28px;
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--fg-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease-default);
}
.api-tabs .tab .en {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.api-tabs .tab:hover {
  color: var(--ink);
}
.api-tabs .tab:hover .en {
  color: var(--fg-2);
}
.api-tabs .tab.active {
  color: var(--ink);
  border-bottom-color: var(--yangli-red);
  font-weight: 500;
}
.api-tabs .tab.active .en {
  color: var(--yangli-red);
}

/* ============ 单列 tab pane（凭证 / 模板字段） ============ */
.tab-pane {
  max-width: 1080px;
  margin: 0 auto;
}
.pane-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 12px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.pane-title .han {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-3);
  font-weight: 400;
}
.pane-desc {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-2);
  line-height: 1.85;
  margin: 0 0 18px;
}
.pane-desc code {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

/* ============ 文档两栏布局 ============ */
.docs-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 32px;
  max-width: 1240px;
  margin: 0 auto;
}

/* TOC */
.toc {
  position: sticky;
  top: 0;
  align-self: start;
  border-left: 1px solid var(--stone);
}
.toc-head {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0 0 10px 16px;
}
.toc nav {
  display: flex;
  flex-direction: column;
}
.toc nav a {
  display: block;
  padding: 6px 0 6px 16px;
  margin-left: -1px;
  border-left: 1px solid transparent;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  text-decoration: none;
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.toc nav a:hover {
  color: var(--ink);
}
.toc nav a.active {
  color: var(--yangli-red);
  border-left-color: var(--yangli-red);
  font-weight: 500;
}
.toc nav a.sub {
  padding-left: 32px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
}
.toc nav a.sub:hover {
  color: var(--ink);
}
.toc nav a.sub.active {
  color: var(--yangli-red);
  border-left-color: var(--yangli-red);
}

/* Main docs column */
.docs {
  max-width: 880px;
}
.docs h1 {
  font-size: 32px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.01em;
  margin: 0 0 8px;
}
.docs .lede {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 36px;
}
.docs section {
  margin-bottom: 48px;
}
.docs p {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--fg-2);
  line-height: 1.85;
  margin: 0 0 14px;
  max-width: 720px;
}
.docs p code {
  font-size: 12px;
}

/* Section 头：[mono num] [红方块] [han 标题] [mono en] [延展线] */
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin: 8px 0 16px;
}
.sec-head .num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--yangli-red);
  letter-spacing: 0.1em;
}
.sec-head .red-square {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--yangli-red);
  align-self: center;
}
.sec-head h2 {
  margin: 0;
  font-family: var(--font-han);
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
}
.sec-head .en {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sec-head .rule {
  flex: 1;
  height: 1px;
  background: var(--stone);
  align-self: center;
}

/* ============ 鉴权紧凑 callout ============ */
.auth-quick {
  background: var(--mist);
  border: 1px solid var(--stone);
  border-left: 2px solid var(--yangli-red);
  padding: 16px 20px;
  margin: 8px 0 24px;
}
.auth-quick .l {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--yangli-red);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.auth-quick p {
  margin: 0;
  font-size: 13px;
}
.auth-quick .code {
  margin-top: 10px;
  padding: 10px 14px;
  background: var(--ink);
  color: var(--paper-white);
  font-family: var(--font-mono);
  font-size: 12.5px;
  border-radius: var(--radius-2);
  overflow-x: auto;
}
.auth-quick details {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--stone);
}
.auth-quick details summary {
  cursor: pointer;
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--fg-2);
  list-style: none;
}
.auth-quick details summary::-webkit-details-marker {
  display: none;
}
.auth-quick details summary::before {
  content: '＋ ';
  color: var(--yangli-red);
  font-family: var(--font-mono);
}
.auth-quick details[open] summary::before {
  content: '－ ';
}
.auth-quick details p {
  margin-top: 8px;
  font-size: 12.5px;
}

/* ============ 接口手风琴 ============ */
.endpoints {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  background: var(--paper-white);
  overflow: hidden;
}
.ep {
  border-bottom: 1px solid var(--stone);
  scroll-margin-top: 16px;
}
.ep:last-child {
  border-bottom: 0;
}
.ep-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  cursor: pointer;
  background: var(--paper-white);
  user-select: none;
  transition: background var(--dur-fast) var(--ease-default);
}
.ep-head:hover {
  background: var(--mist);
}
.ep.open > .ep-head {
  background: var(--mist);
  border-bottom: 1px solid var(--stone);
}
.method {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  color: var(--paper-white);
  border-radius: var(--radius-1);
  flex: none;
}
.method.post {
  background: #0f8c5a;
}
.method.get {
  background: var(--yangli-graphite);
}
.ep-path {
  font-family: var(--font-mono);
  font-size: 13.5px;
  color: var(--ink);
  font-weight: 500;
}
.ep-desc {
  margin-left: auto;
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
}
.ep .chev {
  width: 16px;
  height: 16px;
  color: var(--fg-3);
  display: inline-flex;
  align-items: center;
  transition: transform var(--dur-base) var(--ease-default);
}
.ep.open .chev {
  transform: rotate(180deg);
  color: var(--yangli-red);
}

/* 接口内 sub-tabs */
.ep-body {
  padding: 0;
}
.ep-tabs {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--stone);
  padding: 0 18px;
}
.ep-tab {
  padding: 10px 0;
  margin-right: 20px;
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.ep-tab .num {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  margin-left: 6px;
  letter-spacing: 0.04em;
}
.ep-tab:hover {
  color: var(--ink);
}
.ep-tab.active {
  color: var(--ink);
  border-bottom-color: var(--yangli-red);
  font-weight: 500;
}
.ep-tab.active .num {
  color: var(--yangli-red);
}
.ep-pane {
  padding: 20px 22px 24px;
}
.ep-pane .pane-intro {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  line-height: 1.8;
  margin: 0 0 16px;
}
.ep-pane .pane-label {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  margin: 18px 0 8px;
}
.ep-pane .pane-label:first-child {
  margin-top: 0;
}
.behavior {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-2);
  line-height: 1.8;
  padding-left: 20px;
  margin: 16px 0 0;
}
.behavior li::marker {
  color: var(--yangli-red);
}

/* ============ 紧凑 spec 表 ============ */
table.spec {
  width: 100%;
  border-collapse: collapse;
  background: var(--paper-white);
  margin: 0 0 4px;
}
table.spec th {
  text-align: left;
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 8px 12px;
  border-bottom: 1px solid var(--stone);
  background: var(--mist);
}
table.spec th.th-req {
  text-align: center;
  width: 6%;
}
table.spec td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--stone);
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-1);
  vertical-align: top;
}
table.spec tr:last-child td {
  border-bottom: 0;
}
table.spec td.code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink);
  width: 28%;
}
table.spec td.type {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  width: 18%;
}
table.spec td.req {
  width: 6%;
  text-align: center;
}
table.spec td.req .y {
  color: var(--yangli-red);
  font-weight: 600;
}
table.spec td.req .n {
  color: var(--fg-3);
}

/* ============ 代码块（带语言切换 + COPY） ============ */
.code-wrap {
  background: var(--ink);
  border-radius: var(--radius-2);
  overflow: hidden;
  margin-top: 18px;
}
.code-wrap.spaced {
  margin-top: 18px;
}
.code-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
}
.code-tab {
  padding: 9px 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  margin-bottom: -1px;
}
.code-tab:hover {
  color: var(--paper-white);
}
.code-tab.active {
  color: var(--paper-white);
  border-bottom-color: var(--yangli-red);
}
.code-tab.static {
  cursor: default;
  color: rgba(255, 255, 255, 0.4);
}
.code-tab.static:hover {
  color: rgba(255, 255, 255, 0.4);
}
.code-actions {
  display: flex;
  align-items: center;
  margin-left: auto;
  padding: 6px;
  gap: 8px;
}
.code-actions button {
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: var(--radius-1);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
}
.code-actions button:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--paper-white);
}
pre.code {
  margin: 0;
  padding: 14px 18px;
  background: var(--ink);
  color: var(--paper-white);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}

/* ============ 我的 Token section ============ */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 16px;
}
.section-head .pane-title {
  margin: 0;
}

.callout {
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-top: 2px solid var(--yangli-red);
  padding: 18px 22px;
  margin-bottom: 18px;
}
.callout .cap {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--yangli-red);
  margin-bottom: 6px;
}
.callout .title {
  font-family: var(--font-han);
  font-size: 15px;
  color: var(--ink);
  font-weight: 600;
  margin-bottom: 4px;
}
.callout .desc {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  line-height: 1.75;
}

.card {
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  overflow: hidden;
}
.card-body.flush {
  padding: 0;
}
.empty-state {
  padding: 40px 22px;
  text-align: center;
}
.empty-state .eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.empty-state .hint,
.empty-state .msg {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  margin-top: 8px;
}

table.tokens-table {
  width: 100%;
  border-collapse: collapse;
}
table.tokens-table th {
  text-align: left;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 12px 20px;
  border-bottom: 1px solid var(--stone);
  background: var(--mist);
}
table.tokens-table td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--stone);
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-1);
  vertical-align: middle;
}
table.tokens-table tr:last-child td {
  border-bottom: 0;
}
table.tokens-table tr.revoked td {
  color: var(--fg-3);
}
table.tokens-table .name {
  color: var(--ink);
  font-weight: 500;
}
table.tokens-table .prefix {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-2);
}
.revoke-link {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--yangli-red);
  text-decoration: none;
  border-bottom: 1px solid var(--yangli-red);
  padding-bottom: 1px;
  cursor: pointer;
}
.revoke-link:hover {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}
.muted {
  color: var(--fg-3);
}
.footer-meta {
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  padding: 10px 20px;
  border-top: 1px solid var(--stone);
  letter-spacing: 0.04em;
}

/* ============ 模板字段行 ============ */
.tpl-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 16px 18px;
  border-bottom: 1px solid var(--stone);
  gap: 24px;
  align-items: start;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-default);
}
.tpl-row:hover {
  background: rgba(220, 216, 210, 0.25);
}
.tpl-row.head {
  background: var(--mist);
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
  padding: 12px 18px;
  cursor: default;
}
.tpl-row.head:hover {
  background: var(--mist);
}
.tpl-row:last-child {
  border-bottom: 0;
}
.tpl-row .name {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.tpl-row .id {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
  margin-top: 4px;
  letter-spacing: 0.02em;
  word-break: break-all;
}
.tpl-row .expand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  cursor: pointer;
}
.tpl-row .expand:hover {
  color: var(--yangli-red);
  border-bottom-color: var(--yangli-red);
}
.tpl-row .expand svg {
  color: var(--fg-3);
}
.field-hint {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  line-height: 1.7;
}
.field-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.field-list li {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--stone);
}
.field-list li:last-child {
  margin-bottom: 0;
  border-bottom: 0;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.field-key {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink);
  background: var(--mist);
  border: 1px solid var(--stone);
  padding: 1px 6px;
  border-radius: var(--radius-1);
}
.field-type {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
}
.field-required {
  font-family: var(--font-han);
  font-size: 11px;
  color: var(--yangli-red);
  padding: 1px 6px;
  border: 1px solid var(--yangli-red);
  border-radius: var(--radius-1);
}
.field-meta {
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--fg-3);
  margin-top: 3px;
}
.field-meta code {
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.tpl-schema {
  padding: 8px 18px 16px;
  border-bottom: 1px solid var(--stone);
}
.tpl-schema summary {
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
}
.tpl-schema summary:hover {
  color: var(--ink);
}
.tpl-schema pre.code {
  margin-top: 8px;
  max-height: 280px;
  overflow: auto;
  border-radius: var(--radius-2);
}

/* ============ Token dialog 共用 ============ */
.dlg-body {
  padding: 4px 0 0;
}
.dlg-body .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dlg-body .lbl {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: var(--tr-caption);
  text-transform: uppercase;
  color: var(--fg-3);
}
.dlg-body .lbl .han {
  font-family: var(--font-han);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
}
.dlg-hint {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
  line-height: 1.7;
  margin: 12px 0 0;
}
.dlg-hint code {
  font-family: var(--font-mono);
  font-size: 12px;
}
.warn-box {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: rgba(198, 138, 0, 0.1);
  border-left: 3px solid #c68a00;
  padding: 12px 14px;
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 13px;
  color: #6e5300;
  line-height: 1.65;
  margin-bottom: 14px;
}
.warn-box .ico {
  color: #c68a00;
  flex-shrink: 0;
  margin-top: 1px;
}
.warn-box strong {
  color: #5a4200;
}
.plaintext-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ink);
  color: var(--paper-white);
  padding: 10px 12px;
  border-radius: var(--radius-2);
  margin-bottom: 10px;
}
.plaintext {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  background: transparent;
  color: var(--paper-white);
  word-break: break-all;
  border: 0;
  padding: 0;
}
</style>
