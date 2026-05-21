// eslint-disable-next-line import/no-unresolved -- vitest subpath export; resolver not configured yet
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
