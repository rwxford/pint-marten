import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildOverpassQuery, fetchOverpass, OverpassError, parseOverpass, venueKind } from './osm';

const fixture = JSON.parse(readFileSync('tests/fixtures/overpass-raleigh.json', 'utf8'));
const box = { south: 35.75, west: -78.7, north: 35.8, east: -78.6 };

describe('buildOverpassQuery', () => {
	it('asks for drinking venues inside the box only', () => {
		const q = buildOverpassQuery(box);
		expect(q).toContain('(35.75000,-78.70000,35.80000,-78.60000)');
		expect(q).toContain('"amenity"~"^(bar|pub|biergarten)$"');
		expect(q).toContain('"craft"~"^(brewery|cider|winery|meadery)$"');
		expect(q).toContain('"shop"~"^(alcohol|beverages)$"');
		expect(q).toContain('out center tags;');
	});
});

describe('parseOverpass', () => {
	const venues = parseOverpass(fixture);
	const byId = new Map(venues.map((v) => [v.osmId, v]));

	it('keeps named, recognized venues and drops the rest', () => {
		expect(venues.map((v) => v.name).sort()).toEqual([
			'Bottle Stop',
			'Fictional Fox Brewing Company',
			'Garden Hall',
			'Golden Comb Meadery',
			'Orchard Hollow Cider',
			'Test Taproom',
			'The Corner Pub'
		]);
	});

	it('uses the center point for buildings and areas', () => {
		expect(byId.get('way/202')).toMatchObject({ kind: 'brewery', lat: 35.781, lng: -78.64 });
		expect(byId.get('relation/310')).toMatchObject({ kind: 'biergarten' });
	});

	it('classifies kinds and assigns cache cells', () => {
		expect(byId.get('node/105')?.kind).toBe('cidery');
		expect(byId.get('node/106')?.kind).toBe('meadery');
		expect(byId.get('node/108')?.kind).toBe('bottle_shop');
		expect(byId.get('node/101')?.cell).toMatch(/^\d+:-\d+$/);
	});

	it('keeps only http(s) websites', () => {
		expect(byId.get('node/101')?.website).toBe('https://example.com/taproom');
		expect(byId.get('node/103')?.website).toBeNull();
	});

	it('rejects malformed responses', () => {
		expect(() => parseOverpass({})).toThrow();
		expect(parseOverpass({ elements: [null, { type: 'node' }] })).toEqual([]);
	});
});

describe('venueKind', () => {
	it('only treats wineries as meaderies or cideries when the name says so', () => {
		expect(venueKind({ craft: 'winery', name: 'Hive Mead Works' })).toBe('meadery');
		expect(venueKind({ craft: 'winery', name: 'Hard Cider Barn' })).toBe('cidery');
		expect(venueKind({ craft: 'winery', name: 'Napa Reds' })).toBeNull();
		expect(venueKind({ amenity: 'restaurant', microbrewery: 'yes' })).toBe('brewery');
	});
});

describe('fetchOverpass', () => {
	it('POSTs the query without credentials or referrer', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture)));
		const venues = await fetchOverpass(box, 'https://overpass.test/api', fetchFn);
		expect(venues).toHaveLength(7);
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe('https://overpass.test/api');
		expect(init).toMatchObject({
			method: 'POST',
			credentials: 'omit',
			referrerPolicy: 'no-referrer'
		});
		expect(decodeURIComponent(init.body)).toContain('out center tags;');
	});

	it('reports a busy server separately from other failures', async () => {
		const busy = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
		await expect(fetchOverpass(box, 'x', busy)).rejects.toMatchObject({ busy: true });
		const broken = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
		await expect(fetchOverpass(box, 'x', broken)).rejects.toBeInstanceOf(OverpassError);
		await expect(fetchOverpass(box, 'x', broken)).rejects.toMatchObject({ busy: false });
	});
});
