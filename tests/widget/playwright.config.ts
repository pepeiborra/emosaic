import { defineConfig, devices } from '@playwright/test';

// Tests load the fixture HTML over file:// — no web server needed.
// We run the same specs across chromium (Chrome/Edge) and webkit (Safari/iOS)
// so layout & SVG-mask differences between engines are caught.
export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retry on CI, and also when targeting a deployed URL — those runs are
  // subject to network jitter that can drop synthetic clicks before the
  // page is ready. Local file:// runs are deterministic; no retries there.
  retries: process.env.CI || process.env.EMOSAIC_FIXTURE_URL ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop-webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
    },
  ],
});
