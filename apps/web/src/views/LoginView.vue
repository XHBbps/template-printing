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

async function goLark(): Promise<void> {
  const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
  try {
    await authStore.logout();
  } catch {
    // ignore — logout endpoint may 401 if already logged out
  }
  window.location.assign(buildLarkLoginUrl(continueTo));
}

async function submitLocal(): Promise<void> {
  if (!username.value || !password.value) {
    ElMessage.warning('请输入用户名和密码');
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
    ElMessage.success('登录成功');
    const continueTo = (router.currentRoute.value.query.continue as string | undefined) ?? '/';
    await router.push(continueTo);
  } catch (e) {
    if (e instanceof ApiClientError) {
      ElMessage.error(e.message);
    } else {
      ElMessage.error('登录失败，请重试');
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
          <span class="tp-l-app">模板打印</span>
        </div>
        <div class="tp-l-build">
          <span><span class="tp-l-red-dot"></span>v 2.4.1 · BUILD 2026·05</span><br />
          <span>YANGZHOU · SINCE 1966</span>
        </div>
      </div>

      <div class="tp-l-display">
        <div class="tp-l-eyebrow">
          <span class="tp-l-rule"></span>
          Internal · Process IT · 流程IT中心
        </div>
        <h1 class="tp-l-h1">
          印一份<br />
          像样的<span class="tp-l-accent">模板。</span>
          <span class="tp-l-en">
            Template-driven, audit-ready document printing for the Yangli Group.
          </span>
        </h1>
      </div>

      <div class="tp-l-stats">
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ rendersStat.value
            }}<span v-if="rendersStat.unit" class="tp-l-unit">{{ rendersStat.unit }}</span>
          </div>
          <div class="tp-l-lbl">月渲染量 <span class="tp-l-lbl-en">RENDERS / MO</span></div>
        </div>
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ p50Stat.value }}<span v-if="p50Stat.unit" class="tp-l-unit">{{ p50Stat.unit }}</span>
          </div>
          <div class="tp-l-lbl">P50 延迟 <span class="tp-l-lbl-en">P50 LATENCY</span></div>
        </div>
        <div class="tp-l-stat">
          <div class="tp-l-num">
            {{ successStat.value
            }}<span v-if="successStat.unit" class="tp-l-unit">{{ successStat.unit }}</span>
          </div>
          <div class="tp-l-lbl">渲染成功率 <span class="tp-l-lbl-en">SUCCESS RATE</span></div>
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
          Sign in · 登录
        </div>
        <h2 class="tp-l-form-h2">欢迎回来</h2>
        <p class="tp-l-form-sub">
          使用扬力账号继续。首次飞书登录会自动建号，登录后可在「个人中心」补密码。
        </p>

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
            <label for="tp-l-user" class="tp-l-floating">
              用户名<span class="tp-l-en-cap">Username</span>
            </label>
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
            <label for="tp-l-pwd" class="tp-l-floating">
              密码<span class="tp-l-en-cap">Password</span>
            </label>
          </div>

          <div class="tp-l-password-row">
            <label class="tp-l-remember">
              <input v-model="remember" type="checkbox" />
              <span class="tp-l-box"></span>
              <span>保持登录 30 天</span>
            </label>
          </div>

          <button type="submit" class="tp-l-submit" :disabled="submitting">
            <span>{{ submitting ? '登录中…' : '登录 · Sign in' }}</span>
            <span class="tp-l-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
            <span class="tp-l-shortcut">↵ ENTER</span>
          </button>
        </form>

        <div class="tp-l-or">OR · 或</div>

        <button type="button" class="tp-l-lark-btn" @click="goLark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="3" y="5" width="18" height="14" />
            <path d="M3 8h18" />
            <circle cx="7" cy="13.5" r="1.2" fill="currentColor" />
          </svg>
          使用飞书登录
        </button>

        <div class="tp-l-foot-note">
          登录即表示同意《<strong>使用规范</strong>》与《<strong>数据保密协议</strong>》。本系统仅供扬力集团内部使用，所有渲染日志可追溯。
        </div>
      </div>

      <div class="tp-l-form-bottom">
        <div class="tp-l-left">
          <a href="#" @click.prevent>系统状态</a>
          <a href="#" @click.prevent>变更日志</a>
          <RouterLink to="/api">API 文档</RouterLink>
        </div>
        <div>© 2026 YANGLI · BRAND OFFICE</div>
      </div>
    </main>
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
