import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 600 } },
      testIgnore: /quickcrop\.touch\.spec\.js$/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 800, height: 600 } },
      testIgnore: /quickcrop\.touch\.spec\.js$/,
    },
    {
      name: 'mobile-touch',
      use: { ...devices['Pixel 7'] }, // chromium with touch; drags driven via CDP touch events
      testMatch: /quickcrop\.touch\.spec\.js$/,
    },
  ],
});
