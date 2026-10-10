import { defineConfig, devices } from '@playwright/test'

const viewport = { width: 900, height: 900 }

// Tests run against the production build: benchmarking a dev build would measure React's dev mode.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', viewport },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', testIgnore: /bench/, use: { ...devices['Desktop Chrome'], viewport } },
    { name: 'firefox', testIgnore: /bench/, use: { ...devices['Desktop Firefox'], viewport } },
    {
      name: 'bench',
      testMatch: /bench\.spec\.ts/,
      fullyParallel: false,
      timeout: 300_000,
      use: { ...devices['Desktop Chrome'], viewport },
    },
  ],
})
