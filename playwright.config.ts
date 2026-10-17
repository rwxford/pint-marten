import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:4173',
		...devices['Pixel 7'],
		launchOptions: {
			// Lets local runs use a preinstalled Chromium when it differs from the version this
			// Playwright release expects. CI installs the matching browser and leaves this unset.
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
		}
	},
	webServer: {
		command: 'pnpm build && pnpm preview --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI
	}
});
