import { fileURLToPath, URL } from 'node:url';

// eslint-disable-next-line import/no-unresolved
import vue from '@vitejs/plugin-vue';
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vite';

// Proxy target: defaults to host-side localhost (works when running `pnpm dev` on host).
// Override via VITE_API_PROXY env var so docker-compose can point to the api container hostname.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Windows + Docker volume-mount: inotify file events do not propagate into
    // the container, so Vite's default chokidar watch sees no changes. Polling
    // is the standard fix.
    watch: {
      usePolling: true,
      interval: 200,
    },
    proxy: {
      // 用 '/api/' 而非 '/api' — 后者会捕获 SPA 路由 /api（无尾斜杠）导致 404。
      // /api/* 仍走后端代理；/api 落到 SPA fallback 由 Vue router 渲染 ApiView。
      '/api/': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
