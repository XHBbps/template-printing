<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

// 占位：实际访问路径（catch-all 直渲，URL 仍是用户输入的那条），超长由 CSS ellipsis 截断
const attemptedPath = ref<string>('/');
// 请求 ID：尽力从后端响应头读取（便于排障）；后端没给就留空、整段省略
const reqId = ref<string>('');

onMounted(() => {
  attemptedPath.value = window.location.pathname || '/';
  void loadReqId();
});

async function loadReqId(): Promise<void> {
  try {
    const res = await fetch('/api/healthz', { method: 'GET', credentials: 'include' });
    const id = res.headers.get('X-Request-Id') ?? res.headers.get('x-request-id') ?? '';
    if (id) reqId.value = id.slice(0, 12);
  } catch {
    // 拿不到就省略，不影响页面
  }
}

function goHome(): void {
  void router.push('/templates');
}

function goBack(): void {
  // 有历史回上一页；没有（直接打开 / 刷新）降级到首页
  if (window.history.length > 1) router.back();
  else void router.push('/');
}
</script>

<template>
  <div class="stage">
    <!-- ───── Top：品牌锁定 + 版本戳 ───── -->
    <header class="top">
      <div class="lockup">
        <img src="/yangli-logo-master.png" alt="YANGLI" />
        <span class="pipe"></span>
        <span class="app">模板打印</span>
      </div>
      <div class="build">
        <span><span class="red-dot"></span>v 2.4.1 · BUILD 2026·05</span><br />
        <span>YANGZHOU · SINCE 1966</span>
      </div>
    </header>

    <!-- ───── Center：双栏 ───── -->
    <main class="center">
      <!-- 左：VOID 印章版「模板叠纸」 -->
      <div class="geom" aria-hidden="true">
        <span class="accent-square s1"></span>
        <span class="accent-ring"></span>

        <div class="doc back"></div>
        <div class="doc mid"></div>

        <div class="doc front">
          <div class="micro-rule"></div>
          <div class="ln long"></div>
          <div class="ln med"></div>
          <div class="ln gray short"></div>
          <div class="ln fail long"></div>
          <div class="ln fail med"></div>
          <div class="ln gray short"></div>
          <div class="ln fail long"></div>
          <div class="void-stamp">VOID</div>
        </div>

        <span class="accent-square s2"></span>
      </div>

      <!-- 右：编辑级文案 -->
      <section class="copy">
        <div class="eyebrow">
          <span class="red-rule"></span>
          Misprint · 寻址失败
        </div>

        <h1 class="num-404">4<span class="accent"></span>4</h1>

        <h2 class="title-cn">这一页不在模板库里</h2>
        <div class="title-en">Page not found</div>

        <p class="body">
          您访问的路径在当前账号下不存在、已被移除，或地址拼写有误。<br />
          请确认链接来源，或返回模板中心继续工作。
        </p>

        <div class="receipt">
          <span class="l">URL</span>
          <span class="path" :title="attemptedPath">{{ attemptedPath }}</span>
          <span class="status">HTTP 404</span>
        </div>

        <div class="ctas">
          <button class="btn btn-primary" type="button" @click="goHome">
            <span>回到模板中心</span>
            <span class="arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
          <button class="btn btn-secondary" type="button" @click="goBack">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="m15 18-6-6 6-6" />
            </svg>
            返回上一页
          </button>
        </div>
      </section>
    </main>

    <!-- ───── Footer：mono 链接 + 请求 ID ───── -->
    <footer class="foot">
      <div class="left">
        <span class="link">系统状态</span>
        <span class="link">变更日志</span>
        <span class="link">联系流程IT</span>
      </div>
      <div class="right">
        <span v-if="reqId" class="req-id">REQ · {{ reqId }}</span>
        <span>© 2026 YANGLI · BRAND OFFICE</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 720px;
  display: grid;
  grid-template-rows: 64px 1fr 80px;
  overflow: hidden;
  color: var(--fg-1);
  font-family: var(--font-sans);
  /* 极淡 14px 圆点底纹 */
  background-color: var(--mist);
  background-image: radial-gradient(
    circle at center,
    rgba(89, 87, 89, 0.05) 1px,
    transparent 1.5px
  );
  background-size: 14px 14px;
}

/* ───── Top bar ───── */
.top {
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 48px;
  border-bottom: 1px solid var(--stone);
  background: var(--paper-white);
  position: relative;
  z-index: 5;
}
.top::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 96px;
  background: var(--yangli-red);
}
.lockup {
  display: flex;
  align-items: center;
  gap: 12px;
}
.lockup img {
  height: 20px;
  width: auto;
  display: block;
}
.lockup .pipe {
  width: 1px;
  height: 14px;
  background: var(--stone);
}
.lockup .app {
  font-family: var(--font-han);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.build {
  text-align: right;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  line-height: 1.6;
}
.build .red-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--yangli-red);
  margin-right: 6px;
  transform: translateY(-1px);
}

/* ───── Center ───── */
.center {
  grid-row: 2;
  position: relative;
  display: grid;
  grid-template-columns: 1fr 540px;
  align-items: center;
  padding: 0 80px;
  gap: 80px;
}

/* 左：几何叠纸 */
.geom {
  position: relative;
  height: 480px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.doc {
  position: absolute;
  width: 260px;
  height: 340px;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  padding: 24px 22px;
}
.doc.back {
  background: #2a2a2c;
  border-color: transparent;
  left: 50%;
  top: 50%;
  margin-left: -120px;
  margin-top: -180px;
  transform: rotate(-5deg);
}
.doc.mid {
  background: var(--yangli-red);
  border-color: var(--yangli-red);
  left: 50%;
  top: 50%;
  margin-left: -150px;
  margin-top: -190px;
  transform: rotate(2deg);
  animation: nudge 5s ease-in-out infinite alternate;
}
@keyframes nudge {
  0% {
    transform: rotate(2deg) translateY(0);
  }
  100% {
    transform: rotate(3deg) translateY(-4px);
  }
}
.doc.front {
  left: 50%;
  top: 50%;
  margin-left: -110px;
  margin-top: -170px;
  transform: rotate(-8deg);
  z-index: 2;
}

/* 顶层白纸内容：正常行 + 「打印失败」虚线行 */
.doc.front .micro-rule {
  width: 36px;
  height: 2px;
  background: var(--yangli-red);
  margin-bottom: 14px;
}
.doc.front .ln {
  height: 8px;
  margin-bottom: 8px;
  background: var(--ink);
}
.doc.front .ln.fail {
  background-color: transparent;
  background-image: repeating-linear-gradient(90deg, var(--ink) 0 6px, transparent 6px 14px);
}
.doc.front .ln.short {
  width: 60%;
}
.doc.front .ln.med {
  width: 80%;
}
.doc.front .ln.long {
  width: 100%;
}
.doc.front .ln.gray {
  background-color: #8a8a8c;
  height: 5px;
}

/* VOID 印章 */
.void-stamp {
  position: absolute;
  right: 32px;
  top: 92px;
  width: 120px;
  height: 56px;
  border: 3px double var(--yangli-red);
  color: var(--yangli-red);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.12em;
  transform: rotate(-12deg);
  background: rgba(255, 255, 255, 0.85);
  z-index: 5;
  opacity: 0.9;
  animation: stamp-in 600ms cubic-bezier(0.2, 0, 0, 1) 300ms backwards;
}
@keyframes stamp-in {
  0% {
    opacity: 0;
    transform: rotate(-30deg) scale(2.5);
  }
  60% {
    opacity: 1;
    transform: rotate(-10deg) scale(0.95);
  }
  100% {
    opacity: 0.9;
    transform: rotate(-12deg) scale(1);
  }
}
.void-stamp::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  top: 8px;
  border: 1px solid var(--yangli-red);
  opacity: 0.4;
}

/* 点缀 */
.accent-square {
  position: absolute;
  width: 14px;
  height: 14px;
  background: var(--yangli-red);
}
.accent-square.s1 {
  left: 12%;
  top: 18%;
  animation: pulse 3s ease-in-out infinite;
}
.accent-square.s2 {
  right: 8%;
  bottom: 12%;
  animation: pulse 3s ease-in-out 1.5s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}
.accent-ring {
  position: absolute;
  right: 4%;
  top: 22%;
  width: 60px;
  height: 60px;
  border: 1px solid var(--stone);
  animation: spin 24s linear infinite;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* ───── 右：编辑级文案 ───── */
.copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 540px;
}
.eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 18px;
}
.eyebrow .red-rule {
  width: 36px;
  height: 1px;
  background: var(--yangli-red);
}

.num-404 {
  font-family: var(--font-mono);
  font-size: 144px;
  font-weight: 700;
  line-height: 0.9;
  color: var(--ink);
  letter-spacing: -0.04em;
  display: inline-flex;
  align-items: baseline;
  margin: 0;
}
.num-404 .accent {
  display: inline-block;
  width: 96px;
  height: 96px;
  background: var(--yangli-red);
  margin: 0 4px;
  transform: translateY(8px);
  position: relative;
}
.num-404 .accent::after {
  content: '';
  position: absolute;
  inset: 14px;
  border: 2px solid var(--paper-white);
}

.title-cn {
  font-family: var(--font-han);
  font-size: 28px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.005em;
  margin: 20px 0 4px;
}
.title-en {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-3);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 18px;
}
.body {
  font-family: var(--font-han);
  font-size: 14px;
  color: var(--fg-2);
  line-height: 1.85;
  max-width: 460px;
  margin: 0;
}
.body strong {
  color: var(--ink);
  font-weight: 500;
}

/* 请求收据卡 */
.receipt {
  margin-top: 22px;
  padding: 14px 16px;
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-left: 2px solid var(--yangli-red);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 460px;
  overflow: hidden;
}
.receipt .l {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  flex: none;
}
.receipt .path {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.receipt .status {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--yangli-red);
  letter-spacing: 0.1em;
  flex: none;
}

/* 按钮 */
.ctas {
  margin-top: 28px;
  display: flex;
  gap: 12px;
}
.btn {
  height: 44px;
  padding: 0 22px;
  border-radius: var(--radius-2);
  border: 1px solid transparent;
  font-family: var(--font-han);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  letter-spacing: 0.02em;
  transition:
    background var(--dur-fast) var(--ease-default),
    color var(--dur-fast) var(--ease-default),
    border-color var(--dur-fast) var(--ease-default);
}
.btn-primary {
  background: var(--yangli-red);
  color: var(--paper-white);
  border-color: var(--yangli-red);
}
.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.btn-secondary {
  background: var(--paper-white);
  color: var(--ink);
  border-color: var(--yangli-graphite);
}
.btn-secondary:hover {
  background: var(--ink);
  color: var(--paper-white);
  border-color: var(--ink);
}
.btn svg {
  width: 14px;
  height: 14px;
}
.btn-primary .arrow {
  display: inline-flex;
  transition: transform var(--dur-base) var(--ease-default);
}
.btn-primary:hover .arrow {
  transform: translateX(4px);
}

/* ───── Footer ───── */
.foot {
  grid-row: 3;
  padding: 0 48px;
  border-top: 1px solid var(--stone);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--paper-white);
  position: relative;
  z-index: 5;
}
.foot .left {
  display: flex;
  gap: 20px;
}
.foot .link {
  color: var(--fg-3);
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
  cursor: default;
  transition: color var(--dur-fast) var(--ease-default);
}
.foot .link:hover {
  color: var(--ink);
  border-bottom-color: var(--stone);
}
.foot .right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.foot .right .req-id {
  color: var(--fg-2);
}

/* 窄屏降级：隐藏左侧几何，文案占满 */
@media (max-width: 920px) {
  .center {
    grid-template-columns: 1fr;
    padding: 0 40px;
    gap: 0;
  }
  .geom {
    display: none;
  }
  .num-404 {
    font-size: 112px;
  }
}
</style>
