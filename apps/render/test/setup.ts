// 本地裸机直跑 `pnpm --filter @template-printing/render test` 时,db.ts 默认连容器服务名
// host `postgres`(本机解析不了)。仅当 DATABASE_URL 未设时,回退到 docker-compose.dev.yml
// 的宿主机映射端口(6432)。CI(ci.yml job env 设 localhost:5432)与容器内(compose 设
// postgres:5432)都已先设好该变量,此处的 `??` 守卫不覆盖它们 → 三种环境各自正确。
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:6432/template_printing';
}
