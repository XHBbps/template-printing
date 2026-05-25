<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { ElDialog, ElMessage, ElMessageBox } from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { User as UserIcon } from 'lucide-vue-next';
import { ref } from 'vue';

import { apiFetch, ApiClientError } from '../lib/api';
import { buildLarkLoginUrl } from '../lib/auth-routes';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

// ---- Password dialog ----
const pwdDialogOpen = ref(false);
const pwdCurrent = ref('');
const pwdNew = ref('');
const pwdConfirm = ref('');
const pwdSubmitting = ref(false);
const hasLocalPassword = ref<boolean>(Boolean(auth.user?.hasLocalPassword));

function openPwdDialog(): void {
  pwdCurrent.value = '';
  pwdNew.value = '';
  pwdConfirm.value = '';
  pwdDialogOpen.value = true;
}

async function submitPassword(): Promise<void> {
  if (pwdNew.value !== pwdConfirm.value) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  if (pwdNew.value.length < 8) {
    ElMessage.warning('密码至少 8 位');
    return;
  }
  pwdSubmitting.value = true;
  try {
    const body: { newPassword: string; currentPassword?: string } = { newPassword: pwdNew.value };
    if (hasLocalPassword.value) body.currentPassword = pwdCurrent.value;
    await apiFetch<{ ok: true }>('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    ElMessage.success(hasLocalPassword.value ? '密码已修改' : '密码已设置');
    hasLocalPassword.value = true;
    pwdDialogOpen.value = false;
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '密码设置失败');
  } finally {
    pwdSubmitting.value = false;
  }
}

// ---- Lark binding ----
async function unbindLark(): Promise<void> {
  if (!hasLocalPassword.value) {
    ElMessage.warning('请先设置本地密码后再解绑飞书');
    return;
  }
  try {
    await ElMessageBox.confirm('解绑后将不能再用飞书登录此账号，确认继续？', '解绑飞书', {
      type: 'warning',
      confirmButtonText: '解绑',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await apiFetch<{ ok: true }>('/users/me/lark-binding', { method: 'DELETE' });
    ElMessage.success('已解绑飞书');
    await auth.hydrate();
  } catch (e) {
    ElMessage.error(e instanceof ApiClientError ? e.message : '解绑失败');
  }
}

function rebindLark(): void {
  window.location.assign(buildLarkLoginUrl('/me'));
}

function showLarkRationale(): void {
  void ElMessageBox.alert(
    '绑定飞书后可以：\n· 用飞书 SSO 一键登录，无需记住本地密码\n· 接收渲染完成 / 失败的飞书 IM 通知\n· 在飞书机器人 / 多维表格里发起渲染时回传到你的账号',
    '为什么要绑定飞书？',
    { confirmButtonText: '我知道了', type: 'info' },
  );
}

function showPasswordHistory(): void {
  void ElMessageBox.alert(
    '密码修改历史目前未在前端展示。如需审计，请联系管理员查询数据库 users.password_changed_at 列。',
    '上次修改时间',
    { confirmButtonText: '知道了' },
  );
}
</script>

<template>
  <div class="view-root">
    <!-- ============ Page bar ============ -->
    <header class="page-bar">
      <div class="page-title">
        <span class="ico"><UserIcon :size="20" :stroke-width="1.5" /></span>
        个人中心
      </div>
      <div class="page-sub">ACCOUNT · 账号 / 安全 / 绑定</div>
    </header>

    <!-- ============ Body ============ -->
    <div class="page-body">
      <div class="me-max">
        <div class="stacked">
          <!-- 账号信息 -->
          <section class="card">
            <div class="card-head">
              <div class="cap">账号信息</div>
              <span class="meta">PROFILE</span>
            </div>
            <div class="card-body">
              <div class="row">
                <span class="k">用户名 · Username</span>
                <span class="v">{{ auth.user?.name ?? '—' }}</span>
              </div>
              <div class="row">
                <span class="k">邮箱 · Email</span>
                <span v-if="auth.user?.email" class="v">{{ auth.user.email }}</span>
                <span v-else class="v muted">未提供</span>
              </div>
              <div class="row">
                <span class="k">角色 · Role</span>
                <span class="v">
                  <span class="pill outline role-pill">{{ auth.user?.role ?? '—' }}</span>
                </span>
              </div>
            </div>
          </section>

          <!-- 登录密码 -->
          <section class="card">
            <div class="card-head">
              <div class="cap">登录密码</div>
              <span class="meta">SECURITY · LOCAL PASSWORD</span>
            </div>
            <div class="card-body">
              <div class="row last">
                <span class="k">本地密码</span>
                <span class="v">
                  <span v-if="hasLocalPassword" class="pill ok">已设置 · SET</span>
                  <span v-else class="pill idle">未设置 · UNSET</span>
                </span>
              </div>
              <div class="cta-row">
                <button class="btn btn-secondary" type="button" @click="openPwdDialog">
                  {{ hasLocalPassword ? '修改密码' : '设置密码' }}
                </button>
                <button class="btn btn-ghost" type="button" @click="showPasswordHistory">
                  查看上次修改
                </button>
              </div>
            </div>
          </section>

          <!-- 飞书绑定 -->
          <section class="card">
            <div class="card-head">
              <div class="cap">飞书绑定</div>
              <span class="meta">LARK · SSO &amp; NOTIFY</span>
            </div>
            <div class="card-body">
              <div class="row last">
                <span class="k">飞书账号</span>
                <span class="v">
                  <template v-if="auth.user?.larkUserId">
                    <span class="pill ok">已绑定 · BOUND</span>
                    <code class="muted-id">{{ auth.user.larkUserId }}</code>
                  </template>
                  <span v-else class="pill idle">未绑定 · UNBOUND</span>
                </span>
              </div>
              <div class="cta-row">
                <button
                  v-if="auth.user?.larkUserId"
                  class="btn btn-secondary"
                  type="button"
                  @click="unbindLark"
                >
                  解绑飞书
                </button>
                <button v-else class="btn btn-primary" type="button" @click="rebindLark">
                  绑定飞书账号
                </button>
                <button class="btn btn-ghost" type="button" @click="showLarkRationale">
                  为什么要绑定？
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ============ Password dialog ============ -->
    <ElDialog
      v-model="pwdDialogOpen"
      :title="hasLocalPassword ? '修改密码' : '设置密码'"
      width="460px"
    >
      <div class="dlg-form">
        <div v-if="hasLocalPassword" class="field">
          <label class="lbl">当前密码 <span class="han">· Current</span></label>
          <input v-model="pwdCurrent" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="lbl">新密码 <span class="han">· New</span> · 至少 8 位</label>
          <input v-model="pwdNew" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="lbl">再次输入 <span class="han">· Confirm</span></label>
          <input v-model="pwdConfirm" type="password" autocomplete="new-password" />
        </div>
      </div>
      <template #footer>
        <button class="btn btn-secondary sm" type="button" @click="pwdDialogOpen = false">
          取消
        </button>
        <button
          class="btn btn-primary sm"
          type="button"
          :disabled="pwdSubmitting"
          @click="submitPassword"
        >
          {{ pwdSubmitting ? '提交中…' : '确定' }}
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

.me-max {
  max-width: 780px;
  margin: 0 auto;
}

.stacked > * + * {
  margin-top: 20px;
}

/* ============ Card rows (key/value grid) ============ */
.row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--stone);
  align-items: center;
}
.row:last-child,
.row.last {
  border-bottom: 0;
  padding-bottom: 0;
}
.row .k {
  font-family: var(--font-han);
  font-size: 12.5px;
  color: var(--fg-3);
}
.row .v {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.row .v.muted {
  color: var(--fg-3);
}

/* Override role pill — mono lower-case identifier, not uppercase brand caption */
.role-pill {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: none;
}

.muted-id {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-3);
}

/* ============ CTA row ============ */
.cta-row {
  margin-top: 18px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

/* ============ Dialog form ============ */
.dlg-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 0;
}
.dlg-form .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dlg-form .lbl {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: var(--tr-caption);
  text-transform: uppercase;
  color: var(--fg-3);
}
.dlg-form .lbl .han {
  font-family: var(--font-han);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--fg-3);
}
</style>
