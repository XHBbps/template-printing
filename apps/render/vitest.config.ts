// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 仅注入本地回退用 DATABASE_URL(见 test/setup.ts);不改变任何测试行为。
    setupFiles: ['./test/setup.ts'],
  },
});
