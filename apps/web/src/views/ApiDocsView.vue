<script setup lang="ts">
import { ref } from 'vue';

const tab = ref<'curl' | 'js' | 'python'>('curl');
</script>

<template>
  <div class="page-wrap">
    <h1 class="page-title">API 说明</h1>

    <section class="api-section">
      <h2>异步渲染 API</h2>
      <p class="api-intro">
        调用方传入 templateId + data（变量值），平台进入异步队列渲染，完成后通过 callback URL
        通知调用方。
      </p>

      <h3>端点</h3>
      <div class="api-endpoint">
        <code>POST /api/render</code>
        <span class="api-auth-note">需要登录（cookie 或 CSRF）</span>
      </div>

      <h3>请求体</h3>
      <pre class="api-code">
{
  "templateId": "tpl_xxx",
  "data": {
    "name": "张三",
    "amount": 1200,
    "logo_url": "https://..."
  },
  "formats": ["pdf", "png"],
  "callbackUrl": "https://your-server.com/print-callback"
}</pre
      >

      <h3>同步返回</h3>
      <pre class="api-code">
{
  "jobId": "abc-123-...",
  "status": "pending"
}</pre
      >

      <h3>查询任务状态</h3>
      <div class="api-endpoint">
        <code>GET /api/render/:jobId</code>
      </div>
      <pre class="api-code">
{
  "jobId": "abc-123-...",
  "status": "done",
  "pdfUrl": "/uploads/render/abc-123.pdf",
  "pngUrl": "/uploads/render/abc-123.png",
  "errorMsg": null,
  "completedAt": "2026-05-23T10:30:00Z"
}</pre
      >

      <h3>Webhook 回调 payload</h3>
      <p>渲染完成后，平台会 POST 以下结构到你的 callbackUrl：</p>
      <pre class="api-code">
{
  "jobId": "abc-123-...",
  "status": "done",
  "pdfUrl": "/uploads/render/abc-123.pdf",
  "pngUrl": "/uploads/render/abc-123.png",
  "errorMsg": null
}</pre
      >
      <p class="api-note">失败时 status = "failed"，errorMsg 含错误描述。</p>

      <h3>调用示例</h3>
      <div class="api-tabs">
        <button :class="{ on: tab === 'curl' }" @click="tab = 'curl'">curl</button>
        <button :class="{ on: tab === 'js' }" @click="tab = 'js'">JavaScript</button>
        <button :class="{ on: tab === 'python' }" @click="tab = 'python'">Python</button>
      </div>

      <pre v-if="tab === 'curl'" class="api-code">
curl -X POST https://your-host/api/render \
  -H "Content-Type: application/json" \
  -H "Cookie: tp_access=&lt;your_access_token&gt;" \
  -H "X-CSRF-Token: &lt;your_csrf_token&gt;" \
  -d '{
    "templateId": "tpl_xxx",
    "data": { "name": "张三" },
    "callbackUrl": "https://your-server.com/print-callback"
  }'</pre
      >

      <pre v-else-if="tab === 'js'" class="api-code">
const res = await fetch('https://your-host/api/render', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify({
    templateId: 'tpl_xxx',
    data: { name: '张三' },
    callbackUrl: 'https://your-server.com/print-callback',
  }),
});
const { jobId } = await res.json();
console.log('Render queued:', jobId);</pre
      >

      <pre v-else class="api-code">
import requests

resp = requests.post(
    'https://your-host/api/render',
    json={
        'templateId': 'tpl_xxx',
        'data': { 'name': '张三' },
        'callbackUrl': 'https://your-server.com/print-callback',
    },
    cookies={ 'tp_access': '&lt;your_access_token&gt;' },
    headers={ 'X-CSRF-Token': '&lt;your_csrf_token&gt;' },
)
job_id = resp.json()['jobId']
print('Render queued:', job_id)</pre
      >
    </section>
  </div>
</template>

<style scoped>
.page-wrap {
  padding: 32px 40px;
  max-width: 1000px;
  margin: 0 auto;
}
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px;
  color: var(--tp-ink, #1f1f23);
}
.api-section {
  background: #fff;
  border: 1px solid var(--tp-line, #ececef);
  border-radius: 12px;
  padding: 28px;
}
.api-section h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px;
}
.api-section h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 24px 0 8px;
  color: var(--tp-accent-ink, #4f3fcc);
}
.api-intro {
  color: var(--tp-ink-soft, #5e5e66);
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.7;
}
.api-endpoint {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}
.api-endpoint code {
  background: var(--tp-accent-bg, #f0eeff);
  color: var(--tp-accent-ink, #4f3fcc);
  padding: 4px 12px;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.api-auth-note {
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
}
.api-code {
  background: #1f1f23;
  color: #e0e0e6;
  padding: 14px 18px;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
}
.api-tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}
.api-tabs button {
  background: transparent;
  border: 1px solid var(--tp-line, #ececef);
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--tp-ink-soft, #5e5e66);
}
.api-tabs button.on {
  background: var(--tp-accent, #6c5ce7);
  color: #fff;
  border-color: var(--tp-accent, #6c5ce7);
}
.api-note {
  font-size: 11px;
  color: var(--tp-ink-faint, #9c9ca3);
  margin-top: 8px;
}
</style>
