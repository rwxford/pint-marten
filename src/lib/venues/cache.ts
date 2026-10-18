import type { PintMartenDB } from '../data/db';
import { cellsForBbox, countCells, inBbox, MAX_CELLS_PER_SEARCH, unionBbox } from './grid';
import type { Bbox, OsmVenue } from './types';

/** Cached venue data is refreshed after a week (spec §4.3). */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type VenueFetcher = (bbox: Bbox) => Promise<OsmVenue[]>;

export class AreaTooLargeError extends Error {
	constructor() {
		super('Zoom in to search a smaller area.');
	}
}

/** Cached venues inside the box, without touching the network. */
export async function cachedVenues(db: PintMartenDB, b: Bbox): Promise<OsmVenue[]> {
	// Zoomed-out views show nothing from the cache rather than enumerating a huge grid.
	if (countCells(b) > MAX_CELLS_PER_SEARCH * 4) return [];
	const cells = cellsForBbox(b);
	const venues = await db.osmVenues.where('cell').anyOf(cells).toArray();
	return venues.filter((v) => inBbox(v.lat, v.lng, b));
}

/**
 * Venues inside the box, fetching only the grid cells that are missing or older than a week.
 * All missing cells go out as one query covering their combined area.
 */
export async function loadVenues(
	db: PintMartenDB,
	b: Bbox,
	fetcher: VenueFetcher,
	now = Date.now()
): Promise<{ venues: OsmVenue[]; fetched: boolean }> {
	if (countCells(b) > MAX_CELLS_PER_SEARCH) throw new AreaTooLargeError();
	const cells = cellsForBbox(b);

	const cached = await db.osmCells.bulkGet(cells);
	const stale = cells.filter((c, i) => !cached[i] || now - cached[i]!.fetchedAt > CACHE_TTL_MS);

	if (stale.length > 0) {
		const fetched = await fetcher(unionBbox(stale));
		const staleSet = new Set(stale);
		await db.transaction('rw', db.osmVenues, db.osmCells, async () => {
			await db.osmVenues.where('cell').anyOf(stale).delete();
			// The union box can include parts of fresh cells; only replace stale ones.
			await db.osmVenues.bulkPut(fetched.filter((v) => staleSet.has(v.cell)));
			await db.osmCells.bulkPut(stale.map((cell) => ({ cell, fetchedAt: now })));
		});
	}

	return { venues: await cachedVenues(db, b), fetched: stale.length > 0 };
}
