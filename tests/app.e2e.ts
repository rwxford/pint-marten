import { expect, test, type Page } from '@playwright/test';

/** Collects console errors and CSP violations so tests can assert there are none. */
function trackProblems(page: Page) {
	const problems: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') problems.push(msg.text());
	});
	page.on('pageerror', (err) => problems.push(err.message));
	return problems;
}

test('home page renders with no errors or CSP violations', async ({ page }) => {
	const problems = trackProblems(page);
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) => {
			console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
		});
	});

	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Pint Marten' })).toBeVisible();
	await expect(page).toHaveTitle('Pint Marten');
	expect(problems).toEqual([]);
});

test('ships a strict content security policy', async ({ page }) => {
	await page.goto('/');
	const csp = await page
		.locator('meta[http-equiv="content-security-policy"]')
		.getAttribute('content');

	expect(csp).toContain("default-src 'none'");
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("base-uri 'none'");
	expect(csp).not.toContain('unsafe-inline');
	// 'unsafe-hashes' is allowed only for style attributes, where it permits only hashed values.
	expect(csp).not.toMatch(/script-src[^;]*unsafe-hashes/);
	expect(csp).not.toContain('unsafe-eval');
});

test('is installable: manifest and icons resolve', async ({ page, request }) => {
	await page.goto('/');
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(href).toBeTruthy();

	const manifest = await (await request.get(new URL(href!, page.url()).href)).json();
	expect(manifest.name).toBe('Pint Marten');
	expect(manifest.display).toBe('standalone');
	const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
	expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));

	for (const icon of manifest.icons as { src: string }[]) {
		const res = await request.get(icon.src);
		expect(res.ok(), icon.src).toBe(true);
	}
});

test('works offline after the first visit', async ({ page, context }) => {
	await page.goto('/');
	// Wait until the service worker has installed and taken control of the page.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) {
			await new Promise((resolve) =>
				navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
			);
		}
	});

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Pint Marten' })).toBeVisible();
	await context.setOffline(false);
});
