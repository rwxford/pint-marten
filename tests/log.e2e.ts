import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const overpass = readFileSync('tests/fixtures/overpass-raleigh.json', 'utf8');
const style = JSON.stringify({
	version: 8,
	sources: {},
	layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e4da' } }]
});

test.use({
	geolocation: { latitude: 35.7796, longitude: -78.6382 },
	permissions: ['geolocation'],
	serviceWorkers: 'block',
	// The fixture's check-ins are in US Eastern time; log by hand in the same zone.
	timezoneId: 'America/New_York'
});

function trackProblems(page: Page) {
	const problems: string[] = [];
	page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
	page.on('pageerror', (e) => problems.push(e.message));
	return problems;
}

async function searchNearMe(page: Page) {
	await page.route('https://tiles.openfreemap.org/**', (route) =>
		route.fulfill({ contentType: 'application/json', body: style })
	);
	await page.route('https://overpass-api.de/**', (route) =>
		route.fulfill({ contentType: 'application/json', body: overpass })
	);
	await page.goto('/map');
	await expect(page.locator('.map canvas')).toBeAttached();
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');
}

/** The check-in count on the Home page. */
function checkIns(page: Page) {
	return page.locator('.stat-grid div', { hasText: 'Check-ins' }).locator('dd');
}

async function importUntappd(page: Page) {
	await page.goto('/import');
	const input = page.locator('input[type="file"]');
	await expect(input).toBeEnabled();
	await input.setInputFiles('tests/fixtures/untappd-sample.csv');
	await page.getByRole('button', { name: /^Import \d+ check-ins$/ }).click();
	await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
}

test('marks a map venue visited without logging a drink', async ({ page }) => {
	const problems = trackProblems(page);
	await searchNearMe(page);
	const list = page.getByRole('list', { name: 'Venues' });
	await list.getByRole('button', { name: /Golden Comb Meadery/ }).click();

	const card = page.getByRole('region', { name: 'Selected venue' });
	await expect(card).toContainText('New to you');
	await card.getByRole('button', { name: 'I had a drink here' }).click();
	await expect(card).toContainText('You’ve been here');
	await expect(card.getByRole('status')).toHaveText('Marked Golden Comb Meadery as visited.');
	await expect(card.getByRole('button', { name: 'I had a drink here' })).toBeHidden();
	await expect(list.getByRole('button', { name: /Golden Comb Meadery/ })).toContainText('Visited');

	// Saved on the device.
	await page.reload();
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(list.getByRole('button', { name: /Golden Comb Meadery/ })).toContainText('Visited');
	expect(problems).toEqual([]);
});

test('logs a new drink at a map venue', async ({ page }) => {
	const problems = trackProblems(page);
	await searchNearMe(page);
	const list = page.getByRole('list', { name: 'Venues' });
	await list.getByRole('button', { name: /The Corner Pub/ }).click();

	const card = page.getByRole('region', { name: 'Selected venue' });
	await card.getByRole('button', { name: 'Log a drink…' }).click();
	const form = card.getByRole('form', { name: 'Log a drink' });
	await form.getByRole('button', { name: 'Log drink' }).click();
	await expect(form.getByRole('alert')).toContainText('name and who made it');

	await form.getByLabel('Drink').fill('Corner Lager');
	await form.getByLabel('Made by').fill('Corner Brewing');
	await form.getByLabel('Serving').selectOption('Draft');
	await form.getByLabel('Rating (0–5)').fill('3.5');
	await form.getByRole('button', { name: 'Log drink' }).click();

	await expect(card.getByRole('status')).toHaveText('Logged Corner Lager at The Corner Pub.');
	await expect(form).toBeHidden();
	await expect(card).toContainText('You’ve been here');
	await expect(list.getByRole('button', { name: /The Corner Pub/ })).toContainText('Visited');

	await page.goto('/');
	await expect(checkIns(page)).toHaveText('1');
	expect(problems).toEqual([]);
});

test('logs a drink from history on the Log page', async ({ page }) => {
	const problems = trackProblems(page);
	await importUntappd(page);
	await page.goto('/');
	await page.getByRole('link', { name: 'Log a drink' }).click();
	await expect(page.getByRole('heading', { name: 'Log a drink' })).toBeVisible();

	const form = page.getByRole('form', { name: 'Log a drink' });
	await form.getByLabel('Drink').fill('haze fox');
	await form
		.getByRole('list', { name: 'Drinks you’ve had' })
		.getByRole('button', { name: /Marten Haze/ })
		.click();
	await expect(form).toContainText('already in your history');
	await expect(form.getByLabel('Made by')).toBeHidden();

	await form.getByLabel('Where (optional)').fill('test tap');
	await form
		.getByRole('list', { name: 'Venues you’ve been to' })
		.getByRole('button', { name: /Test Taproom/ })
		.click();
	await form.getByRole('button', { name: 'Log drink' }).click();

	await expect(page.getByRole('status')).toHaveText('Logged Marten Haze at Test Taproom.');
	// The form is cleared for the next drink.
	await expect(form.getByLabel('Drink')).toHaveValue('');
	expect(problems).toEqual([]);
});

test('an import replaces a drink logged by hand', async ({ page }) => {
	const problems = trackProblems(page);
	await page.goto('/log');
	const form = page.getByRole('form', { name: 'Log a drink' });
	await expect(form.getByLabel('When')).not.toHaveValue('');
	await form.getByLabel('Drink').fill('Marten Haze');
	await form.getByLabel('Made by').fill('Fictional Fox Brewing');
	// 10 minutes after the fixture's check-in at 17:19 Eastern.
	await form.getByLabel('When').fill('2024-05-16T17:30');
	await form.getByRole('button', { name: 'Log drink' }).click();
	await expect(page.getByRole('status')).toHaveText('Logged Marten Haze.');

	await importUntappd(page);
	await expect(page.getByText('1 drink you logged in the app was in this export')).toBeVisible();
	await page.goto('/');
	// The fixture has 11 check-ins; the hand-logged twin didn't add a 12th.
	await expect(checkIns(page)).toHaveText('11');
	expect(problems).toEqual([]);
});
