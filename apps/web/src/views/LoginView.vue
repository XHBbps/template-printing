<script setup lang="ts">
/* eslint-disable import/no-unresolved */
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
/* eslint-enable import/no-unresolved */

import { apiFetch, ApiClientError } from '../lib/api';
import { buildLarkLoginUrl } from '../lib/auth-routes';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const remember = ref(true);
const submitting = ref(false);
const lang = ref<'cn' | 'en'>('cn');

// ── 登录页文案字典(整页 CN/EN 切换)──
const messages = {
  cn: {
    app: '模板打印',
    eyebrow: '内部系统 · 流程IT中心',
    h1a: '印一份',
    h1b: '像样的',
    h1accent: '模板。',
    h1sub: '模板驱动、可审计的扬力集团文档打印系统。',
    statRenders: '月渲染量',
    statLatency: 'P50 延迟',
    statSuccess: '渲染成功率',
    signInEyebrow: '登录',
    welcome: '欢迎回来',
    username: '用户名',
    password: '密码',
    remember: '保持登录 30 天',
    signIn: '登录',
    signingIn: '登录中…',
    or: '或',
    larkBtn: '使用飞书登录',
    larkRedirecting: '正在跳转飞书…',
    footNote:
      '登录即表示同意《使用规范》与《数据保密协议》。本系统仅供扬力集团内部使用,所有渲染日志可追溯。',
    statusLink: '系统状态',
    changelogLink: '变更日志',
    apiDocsLink: 'API 文档',
    needCreds: '请输入用户名和密码',
    loginOk: '登录成功',
    loginFail: '登录失败,请重试',
    statusTitle: '系统状态',
    statusChecking: '检测中…',
    statusUp: '服务运行正常',
    statusDown: '服务暂不可用',
    uptime: '已运行',
    mRenders: '近 30 天渲染量',
    mLatency: 'P50 渲染延迟',
    mSuccess: '渲染成功率',
    changelogTitle: '变更日志',
    apiAuthLabel: '鉴权',
    apiAuthDesc: '请求头带 Bearer 令牌;令牌在登录后「API 控制台」创建。',
    apiEndpointsLabel: '主要接口',
    apiRenderDesc: '入队渲染(异步),立即返回 jobId;完成时回调 callbackUrl,或主动轮询。',
    apiPollDesc: '轮询渲染任务状态。',
    apiCallbackLabel: '完成回调',
    apiCallbackDesc: '渲染完成后,平台 POST 以下结构到你的 callbackUrl:',
    apiExampleLabel: '示例',
    apiConsoleNote: '登录后进入「API 控制台」管理令牌、查看模板字段与完整文档。',
    close: '关闭',
  },
  en: {
    app: 'Template Print',
    eyebrow: 'Internal · Process IT Center',
    h1a: 'Print a',
    h1b: 'document worth',
    h1accent: 'keeping.',
    h1sub: 'Template-driven, audit-ready document printing for the Yangli Group.',
    statRenders: 'Renders / mo',
    statLatency: 'P50 latency',
    statSuccess: 'Success rate',
    signInEyebrow: 'Sign in',
    welcome: 'Welcome back',
    username: 'Username',
    password: 'Password',
    remember: 'Keep me signed in for 30 days',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    or: 'OR',
    larkBtn: 'Sign in with Lark',
    larkRedirecting: 'Redirecting to Lark…',
    footNote:
      'By signing in you agree to the Usage Policy and Data Confidentiality Agreement. For internal Yangli Group use only; all render logs are auditable.',
    statusLink: 'System status',
    changelogLink: 'Changelog',
    apiDocsLink: 'API docs',
    needCreds: 'Please enter username and password',
    loginOk: 'Signed in',
    loginFail: 'Sign-in failed, please retry',
    statusTitle: 'System status',
    statusChecking: 'Checking…',
    statusUp: 'All services operational',
    statusDown: 'Service unavailable',
    uptime: 'Uptime',
    mRenders: 'Renders (30d)',
    mLatency: 'P50 render latency',
    mSuccess: 'Success rate',
    changelogTitle: 'Changelog',
    apiAuthLabel: 'Authentication',
    apiAuthDesc:
      'Send a Bearer token in the header; create tokens in the API console after signing in.',
    apiEndpointsLabel: 'Endpoints',
    apiRenderDesc:
      'Enqueue a render (async); returns jobId immediately. Receive a webhook on callbackUrl, or poll.',
    apiPollDesc: 'Poll render job status.',
    apiCallbackLabel: 'Completion callback',
    apiCallbackDesc: 'On completion, the platform POSTs this shape to your callbackUrl:',
    apiExampleLabel: 'Example',
    apiConsoleNote:
      'Sign in to manage tokens, view template fields and full docs in the API console.',
    close: 'Close',
  },
} as const;

const t = computed(() => messages[lang.value]);

interface StatsOverview {
  windowDays: number;
  monthlyRenders: number;
  p50LatencyMs: number | null;
  successRate: number | null;
}

const stats = ref<StatsOverview | null>(null);

onMounted(async () => {
  try {
    stats.value = await apiFetch<StatsOverview>('/stats/overview');
  } catch {
    // 静默失败:保持 stats=null → 三指标显示 —,绝不回退硬编码旧数字
    stats.value = null;
  }
});

function fmtRenders(n: number | null | undefined): { value: string; unit: string } {
  if (n == null) return { value: '—', unit: '' };
  if (n >= 1000) return { value: (n / 1000).toFixed(n >= 10000 ? 0 : 1), unit: 'k' };
  return { value: String(n), unit: '' };
}

const rendersStat = computed(() => fmtRenders(stats.value?.monthlyRenders));
const p50Stat = computed(() => {
  const ms = stats.value?.p50LatencyMs;
  return ms == null ? { value: '—', unit: '' } : { value: (ms / 1000).toFixed(1), unit: 's' };
});
const successStat = computed(() => {
  const r = stats.value?.successRate;
  return r == null ? { value: '—', unit: '' } : { value: (r * 100).toFixed(2), unit: '%' };
});

// ── 系统状态弹窗:点击实时 ping /healthz + 复用月度指标 ──
const statusOpen = ref(false);
const statusState = ref<'checking' | 'up' | 'down'>('checking');
const statusUptime = ref<number | null>(null);

function fmtUptime(s: number | null): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function openStatus(): Promise<void> {
  statusOpen.value = true;
  statusState.value = 'checking';
  statusUptime.value = null;
  try {
    const h = await apiFetch<{ ok: boolean; uptime: number }>('/healthz');
    statusState.value = h?.ok ? 'up' : 'down';
    statusUptime.value = h?.uptime ?? null;
  } catch {
    statusState.value = 'down';
  }
  try {
    stats.value = await apiFetch<StatsOverview>('/stats/overview');
  } catch {
    // 保留已有 stats
  }
}

// ── API 文档弹窗(公开速览,内容取自 /api 控制台文档 tab)──
const apiDocsOpen = ref(false);

// ── 变更日志弹窗:手维护的版本列表(中英双份)──
const changelogOpen = ref(false);
interface ChangelogEntry {
  v: string;
  date: string;
  cn: string[];
  en: string[];
}
const changelog: ChangelogEntry[] = [
  {
    v: '2.4.1',
    date: '2026·05',
    cn: [
      '渲染失败重试与回调可靠性加固(状态机一致性、回调补发)',
      '存储自动清理:孤儿图片 / 审计日志 / 飞书会话',
    ],
    en: [
      'Hardened render retry & callback reliability (state-machine consistency, callback resend)',
      'Automatic storage cleanup: orphan images / audit logs / Lark sessions',
    ],
  },
  {
    v: '2.4.0',
    date: '2026·05',
    cn: ['账号内 / 外部双类型重构', '设计器缩放与渲染回归修复'],
    en: ['Internal / external account type overhaul', 'Designer zoom & render regression fixes'],
  },
  {
    v: '2.3.0',
    date: '2026·04',
    cn: ['飞书多维表格按钮 / 机器人卡片触发渲染', 'Signed URL、日配额与产物自动清理'],
    en: [
      'Lark Bitable button / bot card triggered rendering',
      'Signed URLs, daily quota & output auto-cleanup',
    ],
  },
];
const changelogItems = computed(() =>
  changelog.map((e) => ({ v: e.v, date: e.date, items: lang.value === 'cn' ? e.cn : e.en })),
);

const redirecting = ref(false);

async function goLark(): Promise<void> {
  if (redirecting.value) return;
  redirecting.value = true; // 立刻给反馈,避免点击后页面「无反应」
  const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
  // 预登出改为非阻塞:马上要跳转飞书,SSO 回调会签发全新 cookie 覆盖旧会话,
  // 无需为这次冗余的登出再多等一个慢往返。best-effort 即可。
  void authStore.logout().catch(() => {
    // ignore — logout endpoint may 401 if already logged out
  });
  window.location.assign(buildLarkLoginUrl(continueTo));
}

async function submitLocal(): Promise<void> {
  if (!username.value || !password.value) {
    ElMessage.warning(t.value.needCreds);
    return;
  }
  submitting.value = true;
  try {
    const result = await apiFetch<{ ok: true; csrf: string; mustChangePassword: boolean }>(
      '/auth/local/login',
      {
        method: 'POST',
        body: JSON.stringify({
          username: username.value,
          password: password.value,
          remember: remember.value,
        }),
      },
    );
    await authStore.setLocalLoginResult(result);
    ElMessage.success(t.value.loginOk);
    const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
    await router.push(continueTo);
  } catch (e) {
    if (e instanceof ApiClientError) {
      ElMessage.error(e.message);
    } else {
      ElMessage.error(t.value.loginFail);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="tp-l-page">
    <!-- ───── LEFT · BRAND PANE ───── -->
    <aside class="tp-l-brand-pane">
      <!-- Geometric composition (animated) -->
      <div class="tp-l-composition" aria-hidden="true">
        <div class="tp-l-doc tp-l-doc-red"></div>
        <div class="tp-l-doc tp-l-doc-graphite"></div>
        <div class="tp-l-doc tp-l-doc-paper">
          <div class="tp-l-micro-rule"></div>
          <div class="tp-l-ln tp-l-ln-long"></div>
          <div class="tp-l-ln tp-l-ln-med"></div>
          <div class="tp-l-ln tp-l-ln-gray tp-l-ln-short"></div>
          <div class="tp-l-ln tp-l-ln-gray tp-l-ln-med"></div>
          <div class="tp-l-ln tp-l-ln-gray tp-l-ln-long"></div>
          <div class="tp-l-ln tp-l-ln-gray tp-l-ln-med"></div>
          <div class="tp-l-content-block"></div>
        </div>
      </div>

      <div class="tp-l-accent-sq" aria-hidden="true"></div>
      <div class="tp-l-accent-ring" aria-hidden="true"></div>

      <div class="tp-l-brand-top">
        <div class="tp-l-lockup">
          <img src="/yangli-logo-master.png" alt="YANGLI" />
          <span class="tp-l-pipe"></span>
          <span class="tp-l-app">{{ t.app }}</span>
        </div>
        <div class="tp-l-build">
          <span><span class="tp-l-red-dot"></span>v 2.4.1 · BUILD 2026·05</span><br />
          <span>YANGZHOU · SINCE 1966</span>
        </div>
      </div>

      <div class="tp-l-display">
        <div class="tp-l-eyebrow">
          <span class="tp-l-rule"></span>
          {{ t.eyebrow }}
        </div>
        <h1 class="tp-l-h1">
          {{ t.h1a }}<br />
          {{ t.h1b }}<span class="tp-l-accent">{{ t.h1accent }}</span>
          <span class="tp-l-en">{{ t.h1sub }}</span>
        </h1>
      </div>

      <div class="tp-l-stats">
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ rendersStat.value
            }}<span v-if="rendersStat.unit" class="tp-l-unit">{{ rendersStat.unit }}</span>
          </div>
          <div class="tp-l-lbl">{{ t.statRenders }}</div>
        </div>
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ p50Stat.value }}<span v-if="p50Stat.unit" class="tp-l-unit">{{ p50Stat.unit }}</span>
          </div>
          <div class="tp-l-lbl">{{ t.statLatency }}</div>
        </div>
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ successStat.value
            }}<span v-if="successStat.unit" class="tp-l-unit">{{ successStat.unit }}</span>
          </div>
          <div class="tp-l-lbl">{{ t.statSuccess }}</div>
        </div>
      </div>
    </aside>

    <!-- ───── RIGHT · FORM PANE ───── -->
    <main class="tp-l-form-pane">
      <div class="tp-l-form-top">
        <div class="tp-l-lang">
          <button :class="{ active: lang === 'cn' }" type="button" @click="lang = 'cn'">CN</button>
          <span class="tp-l-sep">/</span>
          <button :class="{ active: lang === 'en' }" type="button" @click="lang = 'en'">EN</button>
        </div>
      </div>

      <div class="tp-l-form-card">
        <div class="tp-l-form-eyebrow">
          <span class="tp-l-red-square"></span>
          {{ t.signInEyebrow }}
        </div>
        <h2 class="tp-l-form-h2">{{ t.welcome }}</h2>
        <!-- 副标题文字已移除,保留占位维持「欢迎回来」与表单的间距 -->
        <p class="tp-l-form-sub" aria-hidden="true"></p>

        <form @submit.prevent="submitLocal">
          <div class="tp-l-field">
            <input
              id="tp-l-user"
              v-model="username"
              class="tp-l-input"
              :class="{ 'tp-l-input--filled': username }"
              type="text"
              placeholder=" "
              autocomplete="username"
              spellcheck="false"
            />
            <label for="tp-l-user" class="tp-l-floating">{{ t.username }}</label>
          </div>
          <div class="tp-l-field">
            <input
              id="tp-l-pwd"
              v-model="password"
              class="tp-l-input"
              :class="{ 'tp-l-input--filled': password }"
              type="password"
              placeholder=" "
              autocomplete="current-password"
              @keyup.enter="submitLocal"
            />
            <label for="tp-l-pwd" class="tp-l-floating">{{ t.password }}</label>
          </div>

          <div class="tp-l-password-row">
            <label class="tp-l-remember">
              <input v-model="remember" type="checkbox" />
              <span class="tp-l-box"></span>
              <span>{{ t.remember }}</span>
            </label>
          </div>

          <button type="submit" class="tp-l-submit" :disabled="submitting">
            <span>{{ submitting ? t.signingIn : t.signIn }}</span>
            <span class="tp-l-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
            <span class="tp-l-shortcut">↵ ENTER</span>
          </button>
        </form>

        <div class="tp-l-or">{{ t.or }}</div>

        <button type="button" class="tp-l-lark-btn" :disabled="redirecting" @click="goLark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="3" y="5" width="18" height="14" />
            <path d="M3 8h18" />
            <circle cx="7" cy="13.5" r="1.2" fill="currentColor" />
          </svg>
          {{ redirecting ? t.larkRedirecting : t.larkBtn }}
        </button>

        <div class="tp-l-foot-note">{{ t.footNote }}</div>
      </div>

      <div class="tp-l-form-bottom">
        <div class="tp-l-left">
          <a href="#" @click.prevent="openStatus">{{ t.statusLink }}</a>
          <a href="#" @click.prevent="changelogOpen = true">{{ t.changelogLink }}</a>
          <a href="#" @click.prevent="apiDocsOpen = true">{{ t.apiDocsLink }}</a>
        </div>
        <div>© 2026 YANGLI · BRAND OFFICE</div>
      </div>
    </main>

    <!-- ───── 系统状态 弹窗 ───── -->
    <Teleport to="body">
      <div v-if="statusOpen" class="tp-l-modal-overlay" @click.self="statusOpen = false">
        <div class="tp-l-modal" role="dialog" aria-modal="true">
          <div class="tp-l-modal-head">
            <span class="tp-l-red-square"></span>
            <span class="tp-l-modal-title">{{ t.statusTitle }}</span>
            <button
              class="tp-l-modal-x"
              type="button"
              :aria-label="t.close"
              @click="statusOpen = false"
            >
              ✕
            </button>
          </div>
          <div class="tp-l-modal-body">
            <div class="tp-l-status-row">
              <span class="tp-l-dot" :class="statusState"></span>
              <span class="tp-l-status-text">
                {{
                  statusState === 'checking'
                    ? t.statusChecking
                    : statusState === 'up'
                      ? t.statusUp
                      : t.statusDown
                }}
              </span>
              <span v-if="statusState === 'up' && statusUptime != null" class="tp-l-status-up">
                {{ t.uptime }} {{ fmtUptime(statusUptime) }}
              </span>
            </div>
            <dl class="tp-l-metrics">
              <div>
                <dt>{{ t.mRenders }}</dt>
                <dd>{{ rendersStat.value }}{{ rendersStat.unit }}</dd>
              </div>
              <div>
                <dt>{{ t.mLatency }}</dt>
                <dd>{{ p50Stat.value }}{{ p50Stat.unit }}</dd>
              </div>
              <div>
                <dt>{{ t.mSuccess }}</dt>
                <dd>{{ successStat.value }}{{ successStat.unit }}</dd>
              </div>
            </dl>
          </div>
          <div class="tp-l-modal-foot">
            <button class="tp-l-modal-btn" type="button" @click="statusOpen = false">
              {{ t.close }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ───── 变更日志 弹窗 ───── -->
    <Teleport to="body">
      <div v-if="changelogOpen" class="tp-l-modal-overlay" @click.self="changelogOpen = false">
        <div class="tp-l-modal" role="dialog" aria-modal="true">
          <div class="tp-l-modal-head">
            <span class="tp-l-red-square"></span>
            <span class="tp-l-modal-title">{{ t.changelogTitle }}</span>
            <button
              class="tp-l-modal-x"
              type="button"
              :aria-label="t.close"
              @click="changelogOpen = false"
            >
              ✕
            </button>
          </div>
          <div class="tp-l-modal-body">
            <div v-for="e in changelogItems" :key="e.v" class="tp-l-cl-entry">
              <div class="tp-l-cl-ver">
                v{{ e.v }}<span class="tp-l-cl-date">{{ e.date }}</span>
              </div>
              <ul class="tp-l-cl-list">
                <li v-for="(it, i) in e.items" :key="i">{{ it }}</li>
              </ul>
            </div>
          </div>
          <div class="tp-l-modal-foot">
            <button class="tp-l-modal-btn" type="button" @click="changelogOpen = false">
              {{ t.close }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ───── API 文档 弹窗(公开速览)───── -->
    <Teleport to="body">
      <div v-if="apiDocsOpen" class="tp-l-modal-overlay" @click.self="apiDocsOpen = false">
        <div class="tp-l-modal" role="dialog" aria-modal="true">
          <div class="tp-l-modal-head">
            <span class="tp-l-red-square"></span>
            <span class="tp-l-modal-title">{{ t.apiDocsLink }}</span>
            <button
              class="tp-l-modal-x"
              type="button"
              :aria-label="t.close"
              @click="apiDocsOpen = false"
            >
              ✕
            </button>
          </div>
          <div class="tp-l-modal-body">
            <div class="tp-l-api-sec">
              <div class="tp-l-api-h">{{ t.apiAuthLabel }}</div>
              <p class="tp-l-api-p">{{ t.apiAuthDesc }}</p>
              <code class="tp-l-code">Authorization: Bearer tpkn_…</code>
            </div>

            <div class="tp-l-api-sec">
              <div class="tp-l-api-h">{{ t.apiEndpointsLabel }}</div>
              <div class="tp-l-api-ep">
                <span class="tp-l-m post">POST</span><code>/api/render</code>
              </div>
              <p class="tp-l-api-p">{{ t.apiRenderDesc }}</p>
              <div class="tp-l-api-ep">
                <span class="tp-l-m get">GET</span><code>/api/render/:jobId</code>
              </div>
              <p class="tp-l-api-p">{{ t.apiPollDesc }}</p>
            </div>

            <div class="tp-l-api-sec">
              <div class="tp-l-api-h">{{ t.apiCallbackLabel }}</div>
              <p class="tp-l-api-p">{{ t.apiCallbackDesc }}</p>
              <pre class="tp-l-code tp-l-code-block">
{ "jobId": "...", "status": "done|failed", "pdfUrl": "...|null", "pngUrl": "...|null", "errorMsg": "...|null" }</pre
              >
            </div>

            <div class="tp-l-api-sec">
              <div class="tp-l-api-h">{{ t.apiExampleLabel }}</div>
              <pre class="tp-l-code tp-l-code-block">
curl 'https://api.yangli.local/api/render' \
  -H 'Authorization: Bearer tpkn_…' \
  -H 'Content-Type: application/json' \
  -d '{"templateId":"…","data":{},"formats":["pdf"]}'</pre
              >
            </div>

            <p class="tp-l-api-note">{{ t.apiConsoleNote }}</p>
          </div>
          <div class="tp-l-modal-foot">
            <button class="tp-l-modal-btn" type="button" @click="apiDocsOpen = false">
              {{ t.close }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 命名空间 tp-l-* 与全局 app-shell.css / colors_and_type.css 隔离 ------- */

.tp-l-page {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  height: 100vh;
  min-height: 720px;
  overflow: hidden;
  background: var(--ink);
}

/* ─────────────── LEFT · BRAND ─────────────── */
.tp-l-brand-pane {
  position: relative;
  background: var(--ink);
  color: var(--paper-white);
  padding: 48px 56px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Subtle grid lines overlay (industrial feel) */
.tp-l-brand-pane::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 80px 80px;
  pointer-events: none;
  z-index: 0;
}
/* Diagonal red stripe sweep */
.tp-l-brand-pane::after {
  content: '';
  position: absolute;
  top: -20%;
  left: -20%;
  width: 140%;
  height: 2px;
  background: var(--yangli-red);
  transform: rotate(-30deg);
  opacity: 0.25;
  z-index: 0;
  animation: tp-l-sweep 14s linear infinite;
}
@keyframes tp-l-sweep {
  0% {
    transform: translateY(-20vh) rotate(-30deg);
    opacity: 0;
  }
  20% {
    opacity: 0.25;
  }
  80% {
    opacity: 0.25;
  }
  100% {
    transform: translateY(120vh) rotate(-30deg);
    opacity: 0;
  }
}

.tp-l-brand-pane > * {
  position: relative;
  z-index: 2;
}

/* Geometric composition */
.tp-l-composition {
  position: absolute;
  z-index: 1;
  right: -120px;
  top: 50%;
  transform: translateY(-50%);
  width: 640px;
  height: 640px;
  pointer-events: none;
}
.tp-l-doc {
  position: absolute;
  border-radius: 0;
}
.tp-l-doc-red {
  width: 360px;
  height: 440px;
  left: 60px;
  top: 120px;
  background: var(--yangli-red);
  transform: rotate(-7deg);
  animation: tp-l-float-red 9s ease-in-out infinite alternate;
}
@keyframes tp-l-float-red {
  0% {
    transform: rotate(-7deg) translateY(0);
  }
  100% {
    transform: rotate(-5deg) translateY(-12px);
  }
}
.tp-l-doc-graphite {
  width: 360px;
  height: 440px;
  left: 120px;
  top: 80px;
  background: #2a2a2c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transform: rotate(-2deg);
  animation: tp-l-float-graphite 11s ease-in-out infinite alternate;
}
@keyframes tp-l-float-graphite {
  0% {
    transform: rotate(-2deg) translateY(0);
  }
  100% {
    transform: rotate(-1deg) translateY(-6px);
  }
}
.tp-l-doc-paper {
  width: 360px;
  height: 440px;
  left: 180px;
  top: 40px;
  background: var(--paper-white);
  transform: rotate(3deg);
  padding: 36px 30px;
  overflow: hidden;
  animation: tp-l-float-paper 13s ease-in-out infinite alternate;
}
@keyframes tp-l-float-paper {
  0% {
    transform: rotate(3deg) translateY(0);
  }
  100% {
    transform: rotate(2deg) translateY(-4px);
  }
}

.tp-l-micro-rule {
  width: 48px;
  height: 3px;
  background: var(--yangli-red);
  margin-bottom: 18px;
}
.tp-l-ln {
  height: 10px;
  background: #1c1c1c;
  margin-bottom: 12px;
  transform-origin: left;
  transform: scaleX(0);
  animation: tp-l-print-line 4s ease-out infinite;
}
.tp-l-ln-short {
  width: 60%;
}
.tp-l-ln-med {
  width: 82%;
}
.tp-l-ln-long {
  width: 100%;
}
.tp-l-ln-gray {
  background: #8a8a8c;
  height: 6px;
}
.tp-l-doc-paper .tp-l-ln:nth-child(2) {
  animation-delay: 0s;
}
.tp-l-doc-paper .tp-l-ln:nth-child(3) {
  animation-delay: 0.25s;
}
.tp-l-doc-paper .tp-l-ln:nth-child(4) {
  animation-delay: 0.5s;
}
.tp-l-doc-paper .tp-l-ln:nth-child(5) {
  animation-delay: 0.75s;
}
.tp-l-doc-paper .tp-l-ln:nth-child(6) {
  animation-delay: 1s;
}
.tp-l-doc-paper .tp-l-ln:nth-child(7) {
  animation-delay: 1.25s;
}
.tp-l-doc-paper .tp-l-ln:nth-child(8) {
  animation-delay: 1.5s;
}
@keyframes tp-l-print-line {
  0% {
    transform: scaleX(0);
  }
  20% {
    transform: scaleX(1);
  }
  80% {
    transform: scaleX(1);
  }
  100% {
    transform: scaleX(0);
  }
}

.tp-l-content-block {
  margin-top: 14px;
  height: 168px;
  background: #f4f2ef;
  border: 1px solid #dcd8d2;
  position: relative;
  overflow: hidden;
}
.tp-l-content-block::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(to right, rgba(89, 87, 89, 0.1) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(89, 87, 89, 0.1) 1px, transparent 1px);
  background-size: 20px 20px;
}
.tp-l-content-block::after {
  content: '';
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  background: var(--yangli-red);
}

.tp-l-accent-sq {
  position: absolute;
  right: 60px;
  top: 96px;
  width: 24px;
  height: 24px;
  background: var(--yangli-red);
  z-index: 1;
  animation: tp-l-pulse 3s ease-in-out infinite;
}
@keyframes tp-l-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.7;
  }
}
.tp-l-accent-ring {
  position: absolute;
  right: 110px;
  bottom: 200px;
  width: 80px;
  height: 80px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  z-index: 1;
  animation: tp-l-spin 26s linear infinite;
}
@keyframes tp-l-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* Top row: logo + spec stamp */
.tp-l-brand-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tp-l-lockup {
  display: flex;
  align-items: center;
  gap: 14px;
}
.tp-l-lockup img {
  height: 22px;
  width: auto;
  display: block;
  filter: brightness(0) invert(1);
}
.tp-l-lockup .tp-l-pipe {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.4);
  display: inline-block;
}
.tp-l-lockup .tp-l-app {
  font-family: var(--font-han);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--paper-white);
  letter-spacing: 0.04em;
}

.tp-l-build {
  text-align: right;
  font-family: var(--font-mono);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  line-height: 1.6;
}
.tp-l-build .tp-l-red-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--yangli-red);
  margin-right: 6px;
  transform: translateY(-1px);
}

/* Editorial display block */
.tp-l-display {
  margin-top: auto;
  max-width: 540px;
}
.tp-l-eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.tp-l-eyebrow .tp-l-rule {
  width: 36px;
  height: 1px;
  background: var(--yangli-red);
  display: inline-block;
}
.tp-l-h1 {
  margin: 0;
  font-family: var(--font-han);
  font-size: 56px;
  font-weight: 700;
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: var(--paper-white);
}
.tp-l-h1 .tp-l-accent {
  color: var(--yangli-red);
  font-weight: 700;
}
.tp-l-h1 .tp-l-en {
  display: block;
  margin-top: 14px;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.04em;
  line-height: 1.5;
}

/* Footer micro-grid: 3 stats */
.tp-l-stats {
  margin-top: 48px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  padding-top: 24px;
  gap: 24px;
  max-width: 540px;
}
.tp-l-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tp-l-num {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 600;
  color: var(--paper-white);
  line-height: 1;
  letter-spacing: -0.01em;
}
.tp-l-unit {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin-left: 4px;
  letter-spacing: 0.04em;
}
.tp-l-lbl {
  font-family: var(--font-han);
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.04em;
}
.tp-l-lbl-en {
  font-family: var(--font-mono);
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-left: 6px;
}

/* ─────────────── RIGHT · FORM ─────────────── */
.tp-l-form-pane {
  background: var(--paper-white);
  display: flex;
  flex-direction: column;
  padding: 48px 64px;
  position: relative;
  overflow-y: auto;
}

.tp-l-form-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tp-l-lang {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  display: flex;
  gap: 12px;
}
.tp-l-lang button {
  border: none;
  background: none;
  font-family: inherit;
  font-size: inherit;
  color: var(--fg-3);
  cursor: pointer;
  padding: 0;
  letter-spacing: inherit;
  text-transform: inherit;
}
.tp-l-lang button.active {
  color: var(--ink);
  font-weight: 500;
}
.tp-l-lang button:hover {
  color: var(--yangli-red);
}
.tp-l-lang .tp-l-sep {
  color: var(--stone);
}

.tp-l-form-card {
  margin: auto 0;
  max-width: 380px;
  width: 100%;
}

.tp-l-form-eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--yangli-red);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.tp-l-red-square {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--yangli-red);
}
.tp-l-form-h2 {
  font-family: var(--font-han);
  font-size: 32px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0 0 8px;
}
.tp-l-form-sub {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-2);
  line-height: 1.65;
  margin: 0 0 36px;
  /* 副标题文字已删,保留约两行占位维持原间距 */
  min-height: 46px;
}

.tp-l-form-card form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 0;
}

.tp-l-field {
  position: relative;
}
.tp-l-input {
  width: 100%;
  height: 56px;
  padding: 22px 14px 8px;
  border: 0;
  border-bottom: 1px solid var(--stone);
  border-radius: 0;
  background: transparent;
  font-family: var(--font-han);
  font-size: 15px;
  color: var(--ink);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--dur-fast) var(--ease-default);
}
.tp-l-input:focus {
  border-bottom-color: var(--yangli-red);
}
.tp-l-input:focus + .tp-l-floating,
.tp-l-input:not(:placeholder-shown) + .tp-l-floating,
.tp-l-input:-webkit-autofill + .tp-l-floating,
.tp-l-input--filled + .tp-l-floating {
  transform: translateY(-18px) scale(0.78);
  color: var(--yangli-red);
}
.tp-l-floating {
  position: absolute;
  left: 14px;
  top: 18px;
  pointer-events: none;
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-3);
  transition:
    transform var(--dur-base) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
  transform-origin: left top;
}
.tp-l-floating .tp-l-en-cap {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-left: 8px;
}

/* Autofill 抹掉 Chrome 浅蓝底（透明 input 上 inset 阴影做白底不合适，用文本色 + 长 transition） */
.tp-l-input:-webkit-autofill,
.tp-l-input:-webkit-autofill:hover,
.tp-l-input:-webkit-autofill:focus,
.tp-l-input:-webkit-autofill:active {
  -webkit-box-shadow: 0 0 0 1000px var(--paper-white) inset !important;
  box-shadow: 0 0 0 1000px var(--paper-white) inset !important;
  -webkit-text-fill-color: var(--ink) !important;
  caret-color: var(--ink);
  transition: background-color 9999s ease-in-out 0s;
}

.tp-l-password-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: -4px;
}
.tp-l-remember {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-2);
  cursor: pointer;
}
.tp-l-remember input {
  display: none;
}
.tp-l-remember .tp-l-box {
  width: 14px;
  height: 14px;
  border: 1px solid var(--yangli-graphite);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tp-l-remember input:checked + .tp-l-box {
  background: var(--ink);
  border-color: var(--ink);
}
.tp-l-remember input:checked + .tp-l-box::after {
  content: '';
  width: 6px;
  height: 3px;
  border-left: 1.5px solid var(--paper-white);
  border-bottom: 1.5px solid var(--paper-white);
  transform: rotate(-45deg) translate(1px, -1px);
}

.tp-l-submit {
  margin-top: 12px;
  height: 52px;
  background: var(--yangli-red);
  color: var(--paper-white);
  border: 1px solid var(--yangli-red);
  border-radius: 4px;
  font-family: var(--font-han);
  font-size: 14.5px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  letter-spacing: 0.02em;
  box-shadow: none;
  transition:
    background var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default),
    transform var(--dur-fast) var(--ease-default);
  position: relative;
}
.tp-l-submit:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.tp-l-submit:active:not(:disabled) {
  background: var(--accent-press);
  border-color: var(--accent-press);
  transform: translateY(1px);
}
.tp-l-submit:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.tp-l-arrow {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  transition: transform var(--dur-base) var(--ease-default);
}
.tp-l-arrow svg {
  width: 100%;
  height: 100%;
}
.tp-l-submit:hover:not(:disabled) .tp-l-arrow {
  transform: translateX(4px);
}
.tp-l-shortcut {
  position: absolute;
  right: 18px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  letter-spacing: 0.08em;
}

.tp-l-or {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 26px 0 18px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.tp-l-or::before,
.tp-l-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--stone);
}

.tp-l-lark-btn {
  width: 100%;
  height: 48px;
  background: var(--paper-white);
  color: var(--ink);
  border: 1px solid var(--yangli-graphite);
  border-radius: 4px;
  font-family: var(--font-han);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: none;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default);
}
.tp-l-lark-btn:hover {
  background: var(--ink);
  color: var(--paper-white);
}
.tp-l-lark-btn svg {
  width: 18px;
  height: 18px;
}

.tp-l-foot-note {
  margin-top: 24px;
  font-family: var(--font-han);
  font-size: 11.5px;
  color: var(--fg-3);
  line-height: 1.85;
  padding-top: 16px;
  border-top: 1px solid var(--stone);
}
.tp-l-foot-note strong {
  color: var(--ink);
  font-weight: 500;
}

.tp-l-form-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: 32px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tp-l-form-bottom .tp-l-left {
  display: flex;
  gap: 16px;
}
.tp-l-form-bottom a {
  color: var(--fg-3);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
}
.tp-l-form-bottom a:hover {
  color: var(--ink);
  border-bottom-color: var(--stone);
}

/* ─────────────── 弹窗(系统状态 / 变更日志)─────────────── */
.tp-l-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(20, 20, 22, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: tp-l-modal-fade var(--dur-fast, 0.15s) var(--ease-default, ease);
}
@keyframes tp-l-modal-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.tp-l-modal {
  background: var(--paper-white);
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  border-top: 3px solid var(--yangli-red);
  overflow: hidden;
}
.tp-l-modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--stone);
}
.tp-l-modal-title {
  font-family: var(--font-han);
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.01em;
}
.tp-l-modal-x {
  margin-left: auto;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--fg-3);
  line-height: 1;
  padding: 4px;
}
.tp-l-modal-x:hover {
  color: var(--yangli-red);
}
.tp-l-modal-body {
  padding: 22px;
  overflow-y: auto;
}
.tp-l-modal-foot {
  padding: 14px 22px;
  border-top: 1px solid var(--stone);
  display: flex;
  justify-content: flex-end;
}
.tp-l-modal-btn {
  height: 38px;
  padding: 0 22px;
  background: var(--ink);
  color: var(--paper-white);
  border: 1px solid var(--ink);
  border-radius: 4px;
  font-family: var(--font-han);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--dur-fast, 0.15s) var(--ease-default, ease);
}
.tp-l-modal-btn:hover {
  background: var(--yangli-red);
  border-color: var(--yangli-red);
}

/* 系统状态 */
.tp-l-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.tp-l-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--stone);
}
.tp-l-dot.up {
  background: #2e9e5b;
  box-shadow: 0 0 0 4px rgba(46, 158, 91, 0.18);
}
.tp-l-dot.down {
  background: var(--yangli-red);
  box-shadow: 0 0 0 4px rgba(206, 32, 39, 0.18);
}
.tp-l-dot.checking {
  background: #c79a2e;
  animation: tp-l-pulse 1.2s ease-in-out infinite;
}
.tp-l-status-text {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.tp-l-status-up {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.04em;
}
.tp-l-metrics {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.tp-l-metrics > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 11px 0;
  border-bottom: 1px solid var(--stone);
}
.tp-l-metrics > div:last-child {
  border-bottom: none;
}
.tp-l-metrics dt {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
}
.tp-l-metrics dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

/* 变更日志 */
.tp-l-cl-entry {
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--stone);
}
.tp-l-cl-entry:last-child {
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: none;
}
.tp-l-cl-ver {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--yangli-red);
  margin-bottom: 10px;
}
.tp-l-cl-date {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--fg-3);
  letter-spacing: 0.06em;
}
.tp-l-cl-list {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tp-l-cl-list li {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  line-height: 1.55;
}

/* API 文档弹窗 */
.tp-l-api-sec {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--stone);
}
.tp-l-api-sec:last-of-type {
  padding-bottom: 0;
  margin-bottom: 14px;
  border-bottom: none;
}
.tp-l-api-h {
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--yangli-red);
  margin-bottom: 10px;
}
.tp-l-api-p {
  margin: 0 0 10px;
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  line-height: 1.55;
}
.tp-l-api-ep {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.tp-l-api-ep code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink);
}
.tp-l-m {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--paper-white);
}
.tp-l-m.post {
  background: #2e9e5b;
}
.tp-l-m.get {
  background: #2f6fb0;
}
.tp-l-code {
  display: block;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink);
  background: #f5f4f2;
  border: 1px solid var(--stone);
  border-radius: 4px;
  padding: 8px 10px;
  overflow-x: auto;
  white-space: pre;
}
.tp-l-code-block {
  margin: 0;
  line-height: 1.5;
}
.tp-l-api-note {
  margin: 0;
  font-family: var(--font-han);
  font-size: 12px;
  color: var(--fg-3);
  line-height: 1.6;
}

/* 极窄屏（< 960px）退化为单列 — 表单优先，品牌叙事作为顶部 banner 收起 */
@media (max-width: 960px) {
  .tp-l-page {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100vh;
  }
  .tp-l-brand-pane {
    padding: 32px 28px;
    min-height: 380px;
  }
  .tp-l-composition {
    right: -200px;
    width: 480px;
    height: 480px;
  }
  .tp-l-h1 {
    font-size: 40px;
  }
  .tp-l-form-pane {
    padding: 32px 28px;
  }
}
</style>
