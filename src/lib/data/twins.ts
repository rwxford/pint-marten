import { distanceMeters, MATCH_RADIUS_M, namesMatch, venueMatchKey } from '../venues/match';
import type { Consumption, PintMartenDB, Venue } from './db';

/** A drink logged in the app and an imported check-in this close in time are the same drink. */
export const MANUAL_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

export function isManual(c: Consumption): boolean {
	return c.rowKey.startsWith('manual:');
}

/** Same place: the same history venue, or venues within 150 m whose names match. */
export function sameVenue(a: Venue, b: Venue): boolean {
	if (a.id === b.id) return true;
	if (a.lat === null || a.lng === null || b.lat === null || b.lng === null)
		return a.nameKey === b.nameKey;
	return (
		distanceMeters(a.lat, a.lng, b.lat, b.lng) <= MATCH_RADIUS_M &&
		namesMatch(venueMatchKey(a.name), venueMatchKey(b.name))
	);
}

/**
 * Finds and removes from `manualByDrink` the hand-logged consumption an imported check-in
 * duplicates: same drink, within two hours, and the same venue (unless either side has none).
 * The closest in time wins.
 */
export function takeManualTwin(
	manualByDrink: Map<number, Consumption[]>,
	drinkId: number,
	ts: number | null,
	venue: Venue | null,
	venueById: Map<number, Venue>
): Consumption | null {
	const list = manualByDrink.get(drinkId);
	if (!list || ts === null) return null;
	let best = -1;
	let bestGap = Infinity;
	for (const [i, c] of list.entries()) {
		if (c.ts === null) continue;
		const gap = Math.abs(c.ts - ts);
		if (gap > MANUAL_MATCH_WINDOW_MS || gap >= bestGap) continue;
		const mv = c.venueId === null ? undefined : venueById.get(c.venueId);
		if (venue && mv && !sameVenue(venue, mv)) continue;
		best = i;
		bestGap = gap;
	}
	return best < 0 ? null : list.splice(best, 1)[0];
}

/**
 * After two drinks are merged on the Review page, removes hand-logged consumptions that an
 * imported check-in now duplicates. Only pairs with one side from each of the merged drinks
 * count, so two pints you deliberately logged for the same drink stay. Returns how many were
 * removed. Runs inside the caller's transaction (consumptions, venues and importJobs).
 */
export async function dropManualTwinsAfterMerge(
	db: PintMartenDB,
	drinkId: number,
	fromIds: ReadonlySet<number>
): Promise<number> {
	const rows = await db.consumptions.where('drinkId').equals(drinkId).toArray();
	const fromSide = (c: Consumption) => fromIds.has(c.id);
	const venueIds = [...new Set(rows.flatMap((c) => (c.venueId === null ? [] : [c.venueId])))];
	const venueById = new Map(
		(await db.venues.bulkGet(venueIds)).flatMap((v) => (v ? [[v.id, v] as const] : []))
	);
	let removed = 0;
	const removedPerJob = new Map<number, number>();
	for (const side of [true, false]) {
		// Imported rows on one side against hand-logged rows on the other.
		const imported = rows.filter((c) => !isManual(c) && fromSide(c) === side);
		const manual = new Map([[drinkId, rows.filter((c) => isManual(c) && fromSide(c) !== side)]]);
		for (const c of imported) {
			const venue = c.venueId === null ? null : (venueById.get(c.venueId) ?? null);
			const twin = takeManualTwin(manual, drinkId, c.ts, venue, venueById);
			if (!twin) continue;
			await db.consumptions.delete(twin.id);
			rows.splice(rows.indexOf(twin), 1);
			removedPerJob.set(twin.importJobId, (removedPerJob.get(twin.importJobId) ?? 0) + 1);
			removed++;
		}
	}
	for (const [id, n] of removedPerJob)
		await db.importJobs
			.where('id')
			.equals(id)
			.modify((j) => {
				j.added = Math.max(0, j.added - n);
			});
	return removed;
}
