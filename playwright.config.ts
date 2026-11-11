import { defineConfig, devices } from '@playwright/test';

const production = process.env.PLAYWRIGHT_SERVER_MODE === 'production';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 1,
  timeout: 20_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: production ? 'npm start' : 'npm run dev',
    url: 'http://127.0.0.1:3100/api/health',
    env: {
      NODE_ENV: production ? 'production' : 'development',
      HOST: '127.0.0.1',
      PORT: '3100',
      DATABASE_PATH: './data/playwright.sqlite',
      OPENAI_API_KEY: '',
      TAVILY_API_KEY: '',
      CHAT_MODEL: '',
    },
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: 'ignore',
  },
});
