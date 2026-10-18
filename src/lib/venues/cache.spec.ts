import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type PintMartenDB } from '../data/db';
import { AreaTooLargeError, CACHE_TTL_MS, cachedVenues, loadVenues } from './cache';
import { parseOverpass } from './osm';

const venues = parseOverpass(
	JSON.parse(readFileSync('tests/fixtures/overpass-raleigh.json', 'utf8'))
);
const box = { south: 35.775, west: -78.645, north: 35.785, east: -78.63 };

let db: PintMartenDB;
let n = 0;
beforeEach(() => {
	db = openDatabase(`venues-${n++}`);
});

describe('loadVenues', () => {
	it('fetches once, then serves from cache', async () => {
		const fetcher = vi.fn().mockResolvedValue(venues);
		const first = await loadVenues(db, box, fetcher, 1000);
		expect(first.fetched).toBe(true);
		expect(first.venues).toHaveLength(7);
		expect(fetcher).toHaveBeenCalledTimes(1);

		const second = await loadVenues(db, box, fetcher, 2000);
		expect(second.fetched).toBe(false);
		expect(second.venues).toHaveLength(7);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('refetches after a week and replaces stale venues', async () => {
		await loadVenues(db, box, vi.fn().mockResolvedValue(venues), 0);
		const fetcher = vi.fn().mockResolvedValue(venues.slice(0, 2));
		const later = await loadVenues(db, box, fetcher, CACHE_TTL_MS + 1);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(later.venues).toHaveLength(2);
	});

	it('only returns venues inside the requested box', async () => {
		await loadVenues(db, box, vi.fn().mockResolvedValue(venues), 0);
		const tiny = await cachedVenues(db, {
			south: 35.7796,
			west: -78.6382,
			north: 35.7798,
			east: -78.638
		});
		expect(tiny.map((v) => v.name)).toEqual(['Test Taproom']);
	});

	it('refuses areas that are too large', async () => {
		const fetcher = vi.fn();
		await expect(
			loadVenues(db, { south: 35, west: -79, north: 36, east: -78 }, fetcher)
		).rejects.toBeInstanceOf(AreaTooLargeError);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('keeps the cache untouched when a fetch fails', async () => {
		await expect(
			loadVenues(db, box, vi.fn().mockRejectedValue(new Error('offline')))
		).rejects.toThrow();
		expect(await db.osmCells.count()).toBe(0);
	});
});
