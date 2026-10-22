import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const overpass = readFileSync('tests/fixtures/overpass-raleigh.json', 'utf8');

// Minimal map style so tests never depend on the real tile server.
// One labeled place stands in for the base map's points of interest: a restaurant the venue
// search doesn't return.
const fridays = { lat: 35.7786, lng: -78.6375 };
const style = JSON.stringify({
	version: 8,
	sources: {
		pois: {
			type: 'geojson',
			data: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [fridays.lng, fridays.lat] },
						properties: { name: "TGI Friday's", class: 'restaurant' }
					}
				]
			}
		}
	},
	layers: [
		{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e4da' } },
		// Wider than the tap radius, like a long text label: taps far from the point still land on it.
		{ id: 'poi', type: 'circle', source: 'pois', paint: { 'circle-radius': 30 } }
	]
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

/**
 * Taps the map until `check` passes. Software WebGL in CI can take a few frames to draw the
 * dots after a search, and a tap only finds what has been drawn.
 */
async function tapWhenDrawn(page: Page, x: number, y: number, check: () => Promise<void>) {
	await expect(page.getByRole('region', { name: 'Map of nearby venues' })).toHaveAttribute(
		'data-origin',
		'you'
	);
	await expect(async () => {
		await page.mouse.click(x, y);
		await check();
	}).toPass({ timeout: 10_000 });
}

/** Where the test restaurant is drawn after "Near me" (zoom 14, 512 px tiles: ~3.9 m/px). */
async function fridaysOnScreen(page: Page) {
	const user = { lat: 35.7796, lng: -78.6382 };
	const cos = Math.cos((user.lat * Math.PI) / 180);
	const metersPerPx = (40075016 * cos) / (512 * 2 ** 14);
	const box = (await page.getByRole('region', { name: 'Map of nearby venues' }).boundingBox())!;
	return {
		x: box.x + box.width / 2 + ((fridays.lng - user.lng) * 111320 * cos) / metersPerPx,
		y: box.y + box.height / 2 + ((user.lat - fridays.lat) * 110540) / metersPerPx
	};
}

/** Opens the map once the page is interactive: the map canvas only exists after mount. */
async function gotoMap(page: Page) {
	await page.goto('/map');
	await expect(page.locator('.map canvas')).toBeAttached();
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

	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');

	const list = page.getByRole('list', { name: 'Venues' });
	await expect(list.getByRole('listitem')).toHaveCount(7);
	// Closest first; "Test Taproom" is ~15 m away and is in the imported history.
	await expect(list.getByRole('listitem').first()).toContainText('Test Taproom');
	await expect(list.getByRole('listitem').first()).toContainText('Visited');
	await expect(list.getByRole('button', { name: /Golden Comb Meadery/ })).toContainText('Meadery');
	await expect(list.getByRole('button', { name: /Golden Comb Meadery/ })).toContainText('New');

	// A "you are here" dot marks where distances are measured from, with a way back to it.
	const mapRegion = page.getByRole('region', { name: 'Map of nearby venues' });
	await expect(mapRegion).toHaveAttribute('data-origin', 'you');
	await expect(page.getByRole('button', { name: 'Back to me' })).toBeVisible();

	// Only the map area goes to the venue search; nothing from the history.
	expect(calls.overpass).toBe(1);
	expect(decodeURIComponent(calls.bodies[0])).not.toContain('Marten');

	await page.getByRole('checkbox', { name: 'New to me only' }).check();
	await expect(list.getByRole('listitem')).toHaveCount(6);
	await expect(list).not.toContainText('Test Taproom');

	await list.getByRole('button', { name: /Bottle Stop/ }).click();
	await expect(page.getByRole('region', { name: 'Selected venue' })).toContainText('Bottle shop');
	// The map's highlight layer follows the selection.
	await expect(page.getByRole('region', { name: 'Map of nearby venues' })).toHaveAttribute(
		'data-highlighted',
		'node/108'
	);
	// Selecting recenters the map but distances stay measured from the user.
	await expect(page.getByText('Distances from your location.')).toBeVisible();
	await expect(list.getByRole('listitem').first()).toContainText('Garden Hall');

	expect(problems.filter((p) => !p.includes('WebGL'))).toEqual([]);
});

test('uses the saved area on the next visit without searching again', async ({ page }) => {
	const calls = await mockServices(page);
	await gotoMap(page);
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
	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'The venue search service is busy. Try again in a minute.'
	);
});

test('a tap near a venue dot selects it without a pixel-exact hit', async ({ page }) => {
	await mockServices(page);
	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');

	// The map is centered on the user; Test Taproom is ~15 m (about 2 px) away. Tap 14 px off.
	const mapRegion = page.getByRole('region', { name: 'Map of nearby venues' });
	const box = (await mapRegion.boundingBox())!;
	await tapWhenDrawn(page, box.x + box.width / 2 + 14, box.y + box.height / 2, async () =>
		expect(page.getByRole('region', { name: 'Selected venue' })).toContainText('Test Taproom', {
			timeout: 1000
		})
	);
});

test('falls back to GPS when the quick location lookup fails', async ({ page }) => {
	await mockServices(page);
	// Simulate no Wi-Fi or cell positioning: only a high-accuracy (GPS) request succeeds.
	await page.addInitScript(() => {
		const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
		const requests: (boolean | undefined)[] = [];
		(window as unknown as { geoRequests: typeof requests }).geoRequests = requests;
		navigator.geolocation.getCurrentPosition = (ok, fail, options) => {
			requests.push(options?.enableHighAccuracy);
			if (options?.enableHighAccuracy) return real(ok, fail, options);
			fail?.({ code: 2, message: 'unavailable' } as GeolocationPositionError);
		};
	});

	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');
	expect(
		await page.evaluate(() => (window as unknown as { geoRequests: unknown }).geoRequests)
	).toEqual([false, true]);
});

test('does not retry when location permission is denied', async ({ page }) => {
	await mockServices(page);
	await page.addInitScript(() => {
		let calls = 0;
		(window as unknown as { geoCalls: () => number }).geoCalls = () => calls;
		navigator.geolocation.getCurrentPosition = (_ok, fail) => {
			calls++;
			fail?.({ code: 1, message: 'denied' } as GeolocationPositionError);
		};
	});

	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('alert')).toContainText('Location permission is off');
	expect(
		await page.evaluate(() => (window as unknown as { geoCalls: () => number }).geoCalls())
	).toBe(1);
});

test('adds a place from the map and marks it visited by hand', async ({ page }) => {
	await mockServices(page);
	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');

	const { x, y } = await fridaysOnScreen(page);
	const offer = page.getByRole('region', { name: 'Add a place' });
	await tapWhenDrawn(page, x, y, async () =>
		expect(offer).toContainText("TGI Friday's", { timeout: 1000 })
	);
	await expect(offer).toContainText('Restaurant');
	await offer.getByRole('button', { name: 'Add as a beer spot' }).click();

	const card = page.getByRole('region', { name: 'Selected venue' });
	await expect(card).toContainText('New to you');
	const list = page.getByRole('list', { name: 'Venues' });
	await expect(list.getByRole('button', { name: /TGI Friday's/ })).toContainText('New');

	await card.getByRole('checkbox', { name: 'I’ve been here' }).check();
	await expect(card).toContainText('You’ve been here');
	await expect(list.getByRole('button', { name: /TGI Friday's/ })).toContainText('Visited');

	// Saved on the device: still there, still visited, after a reload.
	await page.reload();
	await expect(list.getByRole('button', { name: /TGI Friday's/ })).toContainText('Visited');

	await list.getByRole('button', { name: /TGI Friday's/ }).click();
	await page.getByRole('button', { name: 'Remove this place' }).click();
	await expect(list).not.toContainText("TGI Friday's");
});

test('a tap on the far end of a place label still offers to add it', async ({ page }) => {
	await mockServices(page);
	await gotoMap(page);
	await page.getByRole('button', { name: 'Near me' }).click();
	await expect(page.getByRole('status')).toHaveText('7 venues in this area');

	// 26 px right of the place's point: on its drawn label, but beyond the 22 px tap radius.
	const { x, y } = await fridaysOnScreen(page);
	await tapWhenDrawn(page, x + 26, y, async () =>
		expect(page.getByRole('region', { name: 'Add a place' })).toContainText("TGI Friday's", {
			timeout: 1000
		})
	);
});
