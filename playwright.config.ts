import { defineConfig, devices } from '@playwright/test';

const port = process.env.RRR_PLAYWRIGHT_PORT ?? '4173';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  updateSnapshots: 'none',
  // Every journey here boots a real WebGL renderer plus the Basis/KTX2 WASM
  // transcoders before the behaviour under test can exist. Measured on the
  // 2026-07-26 baseline sweep, that startup alone costs 8-14 s per page load,
  // and several tests load the page more than once. Playwright's 30 s test and
  // 5 s assertion defaults were written for DOM apps and are simply the wrong
  // scale for this suite: 11 of 19 failures in that sweep were budget
  // exhaustion, not defects (two were confirmed passing in isolation, and the
  // 20-restart leak gate reached restart 18 of 20 with every leak assertion
  // green). Raised here once rather than scattered per-test.
  // Evidence: docs/E2E_BASELINE_2026-07-26.md
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    launchOptions: { args: ['--mute-audio'] },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `VITE_QA_MODE=1 npm run build && npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: process.env.RRR_REUSE_SERVER === '1',
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 15'] },
    },
    {
      name: 'tablet-chrome',
      use: { ...devices['Galaxy Tab S9'] },
    },
  ],
});
