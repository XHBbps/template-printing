<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElMessage } from 'element-plus';
import { ref, computed, watch, nextTick } from 'vue';

import { apiFetch, ApiClientError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

const open = computed(() => Boolean(auth.user?.mustChangePassword));

const current = ref('');
const next = ref('');
const confirm = ref('');
const submitting = ref(false);

const showCurrent = ref(false);
const showNew = ref(false);
const showConfirm = ref(false);

const currentInput = ref<HTMLInputElement | null>(null);

// 强密码规则:每满足一项进一档(长度 / 字母 / 数字 / 符号)
const rules = computed(() => ({
  len: next.value.length >= 8,
  letter: /[a-zA-Z]/.test(next.value),
  digit: /[0-9]/.test(next.value),
  symbol: /[^a-zA-Z0-9]/.test(next.value),
}));
const score = computed(() => Object.values(rules.value).filter(Boolean).length);
const strengthTier = computed(() => {
  if (score.value >= 4) return 'strong';
  if (score.value === 3) return 'good';
  if (score.value === 2) return 'fair';
  if (score.value >= 1) return 'weak';
  return '';
});
const strengthLabel = computed(
  () =>
    ({
      weak: 'Weak · 弱',
      fair: 'Fair · 一般',
      good: 'Good · 良好',
      strong: 'Strong · 强',
      '': '',
    })[strengthTier.value],
);

const mismatch = computed(() => confirm.value.length > 0 && next.value !== confirm.value);
const canSubmit = computed(
  () => current.value.length > 0 && next.value.length >= 8 && next.value === confirm.value,
);

// 打开时聚焦第一个输入框(替代 ElDialog 原有的自动聚焦)
watch(open, (v) => {
  if (v) void nextTick(() => currentInput.value?.focus());
});

async function submit(): Promise<void> {
  if (next.value !== confirm.value) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  if (next.value.length < 8) {
    ElMessage.warning('密码至少 8 位');
    return;
  }
  submitting.value = true;
  try {
    await apiFetch<{ ok: true }>('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
    });
    ElMessage.success('密码已修改');
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '密码修改失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mcp-root" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
      <div class="mcp-scrim"></div>

      <div class="mcp-modal">
        <!-- Header -->
        <div class="mcp-head">
          <div class="mcp-eyebrow">
            <span class="mcp-red-sq"></span>
            First-time login · 首次登录
          </div>
          <h1 id="mcp-title">请修改初始密码</h1>
          <p class="mcp-sub">
            系统检测到当前账号正在使用初始 / 临时密码，修改后才能继续使用模板打印。
          </p>
        </div>

        <!-- Body -->
        <div class="mcp-body">
          <!-- Current password -->
          <div class="mcp-field">
            <div class="mcp-field-row">
              <span class="mcp-lbl">当前密码 <span class="mcp-han">· Current</span></span>
              <span class="mcp-hint">INITIAL / TEMP</span>
            </div>
            <div class="mcp-input-wrap">
              <input
                ref="currentInput"
                v-model="current"
                :type="showCurrent ? 'text' : 'password'"
                placeholder="即本次登录使用的初始 / 临时密码"
                autocomplete="current-password"
              />
              <button
                type="button"
                class="mcp-toggle"
                :title="showCurrent ? '隐藏密码' : '显示密码'"
                @click="showCurrent = !showCurrent"
              >
                <svg
                  v-if="!showCurrent"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path
                    d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"
                  />
                  <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
                </svg>
              </button>
            </div>
          </div>

          <!-- New password -->
          <div class="mcp-field">
            <div class="mcp-field-row">
              <span class="mcp-lbl">新密码 <span class="mcp-han">· New</span></span>
              <span class="mcp-hint">MIN 8 · {{ score }}/4</span>
            </div>
            <div class="mcp-input-wrap">
              <input
                v-model="next"
                :type="showNew ? 'text' : 'password'"
                placeholder="至少 8 位，含字母与数字"
                autocomplete="new-password"
              />
              <button
                type="button"
                class="mcp-toggle"
                :title="showNew ? '隐藏密码' : '显示密码'"
                @click="showNew = !showNew"
              >
                <svg
                  v-if="!showNew"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path
                    d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"
                  />
                  <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
                </svg>
              </button>
            </div>
            <div v-if="next.length > 0" class="mcp-strength" :class="strengthTier">
              <div class="mcp-bars">
                <span class="mcp-bar"></span>
                <span class="mcp-bar"></span>
                <span class="mcp-bar"></span>
                <span class="mcp-bar"></span>
              </div>
              <span class="mcp-strength-label">{{ strengthLabel }}</span>
            </div>
            <ul class="mcp-rules">
              <li :class="{ ok: rules.len }"><span class="mcp-check"></span>≥ 8 位</li>
              <li :class="{ ok: rules.letter }"><span class="mcp-check"></span>包含字母</li>
              <li :class="{ ok: rules.digit }"><span class="mcp-check"></span>包含数字</li>
              <li :class="{ ok: rules.symbol }"><span class="mcp-check"></span>含符号（更安全）</li>
            </ul>
          </div>

          <!-- Confirm password -->
          <div class="mcp-field">
            <div class="mcp-field-row">
              <span class="mcp-lbl">再次输入 <span class="mcp-han">· Confirm</span></span>
            </div>
            <div class="mcp-input-wrap">
              <input
                v-model="confirm"
                :type="showConfirm ? 'text' : 'password'"
                placeholder="再次输入新密码"
                autocomplete="new-password"
                @keyup.enter="submit"
              />
              <button
                type="button"
                class="mcp-toggle"
                :title="showConfirm ? '隐藏密码' : '显示密码'"
                @click="showConfirm = !showConfirm"
              >
                <svg
                  v-if="!showConfirm"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path
                    d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"
                  />
                  <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
                </svg>
              </button>
            </div>
            <div v-if="mismatch" class="mcp-err">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="9" />
                <path d="m9 9 6 6M15 9l-6 6" />
              </svg>
              两次输入不一致
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="mcp-foot">
          <div class="mcp-foot-left"><span class="mcp-red-dot"></span>FIRST-LOGIN · 强制修改</div>
          <div class="mcp-actions">
            <!-- 强制改密:不提供"稍后再说" -->
            <button
              class="mcp-btn mcp-btn-primary"
              :disabled="submitting || !canSubmit"
              @click="submit"
            >
              <span>{{ submitting ? '修改中…' : '确认修改' }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 命名空间 mcp-*;颜色/字体/radius 全部走 colors_and_type.css 变量 */
.mcp-root {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.mcp-scrim {
  position: absolute;
  inset: 0;
  background: rgba(28, 28, 28, 0.55);
}

.mcp-modal {
  position: relative;
  z-index: 1;
  width: 480px;
  max-width: 94vw;
  max-height: 92vh;
  overflow: auto;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-top: 2px solid var(--yangli-red);
  border-radius: var(--radius-2);
  box-shadow: 0 24px 60px -20px rgba(28, 28, 28, 0.28);
  animation: mcp-enter 280ms cubic-bezier(0.2, 0, 0, 1) backwards;
}
@keyframes mcp-enter {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Header */
.mcp-head {
  padding: 22px 28px 18px;
  border-bottom: 1px solid var(--stone);
}
.mcp-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--yangli-red);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.mcp-red-sq {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--yangli-red);
}
.mcp-head h1 {
  margin: 0 0 6px;
  font-family: var(--font-han);
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.005em;
}
.mcp-sub {
  font-family: var(--font-han);
  font-size: 13px;
  color: var(--fg-2);
  line-height: 1.7;
  margin: 0;
}

/* Body */
.mcp-body {
  padding: 20px 28px 8px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Field */
.mcp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mcp-field-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.mcp-lbl {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tr-caption);
  color: var(--fg-3);
}
.mcp-han {
  font-family: var(--font-han);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  margin-left: 6px;
  color: var(--fg-3);
}
.mcp-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.mcp-input-wrap {
  position: relative;
}
.mcp-field input {
  width: 100%;
  height: 42px;
  padding: 0 40px 0 14px;
  border: 1px solid var(--stone);
  border-radius: var(--radius-1);
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--ink);
  background: var(--paper-white);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-default);
}
.mcp-field input::placeholder {
  color: var(--fg-3);
  font-family: var(--font-han);
}
.mcp-field input:focus {
  border-color: var(--yangli-red);
  outline: 1px solid var(--yangli-red);
  outline-offset: -1px;
}
.mcp-field input:focus + .mcp-toggle {
  color: var(--yangli-red);
}

/* Visibility toggle (eye) */
.mcp-toggle {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--fg-3);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color var(--dur-fast) var(--ease-default);
}
.mcp-toggle:hover {
  color: var(--ink);
}
.mcp-toggle svg {
  width: 16px;
  height: 16px;
}

/* Password strength meter */
.mcp-strength {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mcp-bars {
  display: flex;
  gap: 4px;
  flex: 1;
}
.mcp-bar {
  height: 3px;
  flex: 1;
  background: var(--stone);
}
.mcp-strength.weak .mcp-bar:nth-child(1) {
  background: var(--yangli-red);
}
.mcp-strength.fair .mcp-bar:nth-child(-n + 2) {
  background: #c68a00;
}
.mcp-strength.good .mcp-bar:nth-child(-n + 3) {
  background: #0f8c5a;
}
.mcp-strength.strong .mcp-bar {
  background: #0f8c5a;
}
.mcp-strength-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-3);
  flex: none;
}
.mcp-strength.weak .mcp-strength-label {
  color: var(--yangli-red);
}
.mcp-strength.fair .mcp-strength-label {
  color: #c68a00;
}
.mcp-strength.good .mcp-strength-label,
.mcp-strength.strong .mcp-strength-label {
  color: #0f8c5a;
}

/* Validation checklist */
.mcp-rules {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 14px;
}
.mcp-rules li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-han);
  font-size: 11.5px;
  color: var(--fg-3);
}
.mcp-check {
  width: 10px;
  height: 10px;
  border: 1px solid var(--stone);
  flex: none;
  position: relative;
}
.mcp-rules li.ok {
  color: var(--fg-2);
}
.mcp-rules li.ok .mcp-check {
  background: #0f8c5a;
  border-color: #0f8c5a;
}
.mcp-rules li.ok .mcp-check::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 4px;
  width: 5px;
  height: 2px;
  border-left: 1.5px solid var(--paper-white);
  border-bottom: 1.5px solid var(--paper-white);
  transform: rotate(-45deg);
}

/* Mismatch error */
.mcp-err {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-han);
  font-size: 11.5px;
  color: var(--yangli-red);
}
.mcp-err svg {
  width: 12px;
  height: 12px;
}

/* Footer */
.mcp-foot {
  padding: 18px 28px 20px;
  border-top: 1px solid var(--stone);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background: var(--paper-white);
}
.mcp-foot-left {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mcp-red-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--yangli-red);
  margin-right: 6px;
  transform: translateY(-1px);
}
.mcp-actions {
  display: flex;
  gap: 10px;
}
.mcp-btn {
  height: 38px;
  padding: 0 18px;
  border-radius: var(--radius-2);
  border: 1px solid transparent;
  font-family: var(--font-han);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.mcp-btn-primary {
  background: var(--yangli-red);
  color: var(--paper-white);
  border-color: var(--yangli-red);
}
.mcp-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.mcp-btn-primary:active:not(:disabled) {
  background: var(--accent-press);
  border-color: var(--accent-press);
  transform: translateY(1px);
}
.mcp-btn-primary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.mcp-btn-primary svg {
  width: 14px;
  height: 14px;
  transition: transform var(--dur-base) var(--ease-default);
}
.mcp-btn-primary:hover:not(:disabled) svg {
  transform: translateX(4px);
}
</style>
