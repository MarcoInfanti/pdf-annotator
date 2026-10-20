import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  // Pinned so language detection (navigator.language) is deterministic in every run
  use: { baseURL: 'http://localhost:4300', trace: 'retain-on-failure', locale: 'es-ES' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm start -- --port 4300',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
