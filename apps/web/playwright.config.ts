// eslint-disable-next-line import/no-unresolved
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the web app.
 * The dev server is expected to be already running at http://localhost:5173.
 * Auth is mocked in tests via page.route() interceptors.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use the full Chromium binary installed by `pnpm exec playwright install chromium`.
        // This falls back to the system chromium if the Playwright-managed one is absent.
        launchOptions: {
          // Prefer an env-var override; fall back to the Alpine system chromium
          // (installed via `apk add chromium`) since the Playwright-bundled
          // headless-shell binary doesn't run on Alpine musl libc.
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
});
