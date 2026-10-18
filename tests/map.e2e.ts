import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const overpass = readFileSync('tests/fixtures/overpass-raleigh.json', 'utf8');

// Minimal map style so tests never depend on the real tile server.
const style = JSON.stringify({
	version: 8,
	sources: {},
	layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e4da' } }]
});

test.use({
	geolocation: { latitude: 35.7796, longitude: -78.6382 },
	permissions: ['geolocation'],
	// Keep network mocking deterministic: no service worker in between.
	serviceWorkers: 'block'
});

async function mockServices(page: Page, overpassStatus = 200) {
	const calls = { overpass: 0, bodies: [] as string[] };
	await page.route('https://tiles.openfreemap.org/**', (route) =>
		route.fulfill({ contentType: 'application/json', body: style })
	);
	await page.route('https://overpass-api.de/**', (route) => {
		calls.overpass++;
		calls.bodies.push(route.request().postData() ?? '');
		return overpassStatus === 200
			? route.fulfill({ contentType: 'application/json', body: overpass })
			: route.fulfill({ status: overpassStatus, body: '' });
	});
	return calls;
}

function trackProblems(page: Page) {
	const problems: string[] = [];
	page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
	page.on('pageerror', (e) => problems.push(e.message));
	return problems;
}

async function importUntappd(page: Page) {
	await page.goto('/import');
	const input = page.locator('input[type="file"]');
	await expect(input).toBeEnabled();
	await input.setInputFiles('tests/fixtures/untappd-sample.csv');
	await page.getByRole('button', { name: /^Import \d+ check-ins$/ }).click();
	await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
}

test('finds venues near me and marks the ones I have visited', async ({ page }) => {
	const problems = trackProblems(page);
	const calls = await mockServices(page);
	await importUntappd(page);

	await page.goto('/map');
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');

	const list = page.getByRole('list', { name: 'Venues' });
	await expect(list.getByRole('listitem')).toHaveCount(7);
	// Closest first; "Test Taproom" is ~15 m away and is in the imported history.
	await expect(list.getByRole('listitem').first()).toContainText('Test Taproom');
	await expect(list.getByRole('listitem').first()).toContainText('Visited');
	await expect(list.getByRole('button', { name: /Golden Comb Meadery/ })).toContainText('Meadery');
	await expect(list.getByRole('button', { name: /Golden Comb Meadery/ })).toContainText('New');

	// Only the map area goes to the venue search; nothing from the history.
	expect(calls.overpass).toBe(1);
	expect(decodeURIComponent(calls.bodies[0])).not.toContain('Marten');

	await page.getByRole('checkbox', { name: 'New to me only' }).check();
	await expect(list.getByRole('listitem')).toHaveCount(6);
	await expect(list).not.toContainText('Test Taproom');

	await list.getByRole('button', { name: /Bottle Stop/ }).click();
	await expect(page.getByRole('region', { name: 'Selected venue' })).toContainText('Bottle shop');
	// Selecting recenters the map but distances stay measured from the user.
	await expect(page.getByText('Distances from your location.')).toBeVisible();
	await expect(list.getByRole('listitem').first()).toContainText('Garden Hall');

	expect(problems.filter((p) => !p.includes('WebGL'))).toEqual([]);
});

test('uses the saved area on the next visit without searching again', async ({ page }) => {
	const calls = await mockServices(page);
	await page.goto('/map');
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');

	await page.reload();
	await expect(page.getByRole('list', { name: 'Venues' }).getByRole('listitem')).toHaveCount(7);
	await page.getByRole('button', { name: 'Search this area' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area (saved on this device)');
	expect(calls.overpass).toBe(1);
});

test('explains when the venue search service is busy', async ({ page }) => {
	await mockServices(page, 429);
	await page.goto('/map');
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'The venue search service is busy. Try again in a minute.'
	);
});
