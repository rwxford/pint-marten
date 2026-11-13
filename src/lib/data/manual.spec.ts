import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseImportText } from '../import/file';
import type { ParsedImport } from '../import/types';
import { dateToTimestamp } from '../import/values';
import { addCustomVenue } from '../venues/custom';
import { applyImport } from './apply';
import { openDatabase, type PintMartenDB } from './db';
import {
	drinkOptions,
	filterOptions,
	fromDateTimeLocal,
	logDrink,
	MANUAL_JOB_NAME,
	matchDrink,
	matchVenue,
	venueOptions,
	markVisited,
	toDateTimeLocal,
	toLocalIso,
	venueForPlace,
	type MapPlace
} from './manual';
import { mergeReview, openReviews } from './review';
import { getStats } from './stats';
import { dropManualTwinsAfterMerge } from './twins';

function untappd(): ParsedImport {
	const file = 'untappd-sample.csv';
	const result = parseImportText(readFileSync(`tests/fixtures/${file}`, 'utf8'), file);
	if (result.kind !== 'records') throw new Error('expected records');
	return result.parsed;
}

/** The OpenStreetMap node for the venue the fixture's first check-in (Marten Haze) is at. */
const taproom: MapPlace = { ref: 'node/101', name: 'Test Taproom', lat: 35.7797, lng: -78.6381 };
const pub: MapPlace = { ref: 'node/103', name: 'The Corner Pub', lat: 35.7775, lng: -78.6355 };
const martenHaze = { name: 'Marten Haze', producer: 'Fictional Fox Brewing' };
/** 40 minutes after the fixture's Marten Haze check-in (2024-05-16T17:19:44-04:00). */
const soonAfter = '2024-05-16T18:00:00-04:00';

let db: PintMartenDB;
let n = 0;
beforeEach(() => {
	db = openDatabase(`manual-${n++}`);
});

describe('logDrink', () => {
	it('adds a new drink, producer and venue under the "Logged in app" job', async () => {
		const r = await logDrink(db, {
			drink: { name: 'High & Hazy', producer: 'Terrapin Beer Co.', style: 'IPA', abv: 6.5 },
			venue: { place: pub },
			date: '2026-10-22T16:20:00-04:00',
			rating: 3.4,
			servingType: 'Draft'
		});
		expect(r.newDrink).toBe(true);
		const c = await db.consumptions.get(r.consumptionId);
		expect(c).toMatchObject({ rating: 3.4, servingType: 'Draft', venueId: r.venueId });
		expect(c!.rowKey).toMatch(/^manual:[0-9a-f-]{36}$/);
		expect(c!.ts).toBe(Date.parse('2026-10-22T20:20:00Z'));
		const drink = await db.drinks.get(r.drinkId);
		expect(drink).toMatchObject({ category: 'beer', isNA: false, sourceKey: null });
		const producer = await db.producers.get(drink!.producerId);
		expect(producer).toMatchObject({ name: 'Terrapin Beer Co.', key: 'terrapin' });
		const venue = await db.venues.get(r.venueId!);
		expect(venue).toMatchObject({ name: 'The Corner Pub', sourceKey: 'osm:node/103' });

		const jobs = await db.importJobs.toArray();
		expect(jobs).toEqual([
			expect.objectContaining({ source: 'manual', fileName: MANUAL_JOB_NAME, added: 1 })
		]);

		await logDrink(db, { drink: { drinkId: r.drinkId }, venue: null, date: soonAfter });
		expect(await db.importJobs.toArray()).toEqual([expect.objectContaining({ added: 2 })]);
		expect(await getStats(db)).toMatchObject({ consumptions: 2, drinks: 1, venues: 1 });
	});

	it('matches drinks, producers and venues already in history', async () => {
		await applyImport(db, untappd(), 'export.csv');
		const before = await getStats(db);
		const r = await logDrink(db, {
			drink: { name: 'marten haze', producer: 'The Fictional Fox Brewing Company' },
			venue: { place: taproom },
			date: '2026-01-01T12:00:00Z'
		});
		expect(r.newDrink).toBe(false);
		const after = await getStats(db);
		expect(after).toMatchObject({
			consumptions: before.consumptions + 1,
			drinks: before.drinks,
			producers: before.producers,
			venues: before.venues
		});
		// Joined the imported venue, so it shares the venue's Untappd ID.
		expect((await db.venues.get(r.venueId!))!.sourceKey).toBe('untappd:1001');
	});

	it('marks a place you added as visited', async () => {
		const added = await addCustomVenue(db, {
			name: "TGI Friday's",
			kind: 'restaurant',
			lat: 35.7786,
			lng: -78.6375
		});
		await logDrink(db, {
			drink: martenHaze,
			venue: { place: { ref: added.id, name: added.name, lat: added.lat, lng: added.lng } },
			date: soonAfter
		});
		expect((await db.customVenues.get(added.id))!.visited).toBe(true);
		const venues = await db.venues.toArray();
		expect(venues).toEqual([expect.objectContaining({ sourceKey: `place:${added.id}` })]);
	});

	it('rejects incomplete or out-of-range input', async () => {
		await expect(
			logDrink(db, { drink: { name: 'X', producer: ' ' }, venue: null, date: soonAfter })
		).rejects.toThrow(/producer/);
		await expect(
			logDrink(db, { drink: martenHaze, venue: null, date: 'yesterday' })
		).rejects.toThrow(/date/);
		await expect(
			logDrink(db, { drink: martenHaze, venue: null, date: soonAfter, rating: 6 })
		).rejects.toThrow(/Rating/);
		expect(await getStats(db)).toMatchObject({ consumptions: 0, drinks: 0 });
	});
});

describe('importing after logging by hand', () => {
	it('replaces a hand-logged drink with the imported check-in', async () => {
		const logged = await logDrink(db, {
			drink: martenHaze,
			venue: { place: taproom },
			date: soonAfter
		});
		const r = await applyImport(db, untappd(), 'export.csv');
		expect(r).toMatchObject({ added: 11, replacedManual: 1, reviewItems: 0 });
		expect(await db.consumptions.get(logged.consumptionId)).toBeUndefined();
		expect(await db.consumptions.count()).toBe(11);
		// The imported rows (the fixture has Marten Haze twice) are linked to the same drink.
		const rows = await db.consumptions.where('drinkId').equals(logged.drinkId).toArray();
		expect(rows.map((c) => c.rowKey).sort()).toEqual(['untappd:90001', 'untappd:90002']);
		const manualJob = (await db.importJobs.toArray()).find((j) => j.source === 'manual');
		expect(manualJob!.added).toBe(0);
	});

	it('keeps hand-logged drinks at another time, venue or drink', async () => {
		const later = await logDrink(db, {
			drink: martenHaze,
			venue: { place: taproom },
			date: '2024-05-16T21:00:00-04:00'
		});
		const elsewhere = await logDrink(db, {
			drink: martenHaze,
			venue: { place: pub },
			date: soonAfter
		});
		const other = await logDrink(db, {
			drink: { name: 'Something Else', producer: 'Fictional Fox Brewing' },
			venue: { place: taproom },
			date: soonAfter
		});
		const r = await applyImport(db, untappd(), 'export.csv');
		expect(r.replacedManual).toBe(0);
		for (const c of [later, elsewhere, other])
			expect(await db.consumptions.get(c.consumptionId)).toBeDefined();
	});

	it('matches a hand-logged drink without a venue', async () => {
		await logDrink(db, { drink: martenHaze, venue: null, date: soonAfter });
		const r = await applyImport(db, untappd(), 'export.csv');
		expect(r.replacedManual).toBe(1);
	});
});

describe('merging a near-duplicate on the Review page', () => {
	/** A typo'd hand-logged name for the fixture's first check-in. */
	const typo = { name: 'Marten Hazy', producer: 'Fictional Fox Brewing' };

	it('drops the hand-logged twin when the import came after', async () => {
		const logged = await logDrink(db, { drink: typo, venue: { place: taproom }, date: soonAfter });
		const r = await applyImport(db, untappd(), 'export.csv');
		// Different drinks, so the import can't tell yet; the near-match is queued instead.
		expect(r).toMatchObject({ replacedManual: 0, reviewItems: 1 });
		expect(await db.consumptions.count()).toBe(12);

		const [entry] = await openReviews(db);
		expect(entry).toMatchObject({ newName: 'Marten Haze', candidateName: 'Marten Hazy' });
		expect(await mergeReview(db, entry.item.id)).toBe(1);
		expect(await db.consumptions.get(logged.consumptionId)).toBeUndefined();
		expect(await db.consumptions.count()).toBe(11);
		const manualJob = (await db.importJobs.toArray()).find((j) => j.source === 'manual');
		expect(manualJob!.added).toBe(0);
	});

	it('queues a typo logged after the import, and drops the twin on merge', async () => {
		await applyImport(db, untappd(), 'export.csv');
		const logged = await logDrink(db, { drink: typo, venue: { place: taproom }, date: soonAfter });
		expect(logged.newDrink).toBe(true);
		const [entry] = await openReviews(db);
		expect(entry).toMatchObject({ newName: 'Marten Hazy', candidateName: 'Marten Haze' });
		expect(await mergeReview(db, entry.item.id)).toBe(1);
		expect(await db.consumptions.get(logged.consumptionId)).toBeUndefined();
		expect(await db.drinks.get(logged.drinkId)).toBeUndefined();
	});

	it('keeps a hand-logged drink with no twin on the other side', async () => {
		await applyImport(db, untappd(), 'export.csv');
		// A second pint of a drink already in history: same drink, not part of any merge.
		const pint = await logDrink(db, {
			drink: martenHaze,
			venue: { place: taproom },
			date: soonAfter
		});
		expect(await dropManualTwinsAfterMerge(db, pint.drinkId, new Set())).toBe(0);
		expect(await db.consumptions.get(pint.consumptionId)).toBeDefined();

		const far = await logDrink(db, { drink: typo, venue: { place: pub }, date: soonAfter });
		const [entry] = await openReviews(db);
		expect(await mergeReview(db, entry.item.id)).toBe(0);
		expect(await db.consumptions.get(far.consumptionId)).toMatchObject({ drinkId: pint.drinkId });
	});

	it('does not queue a review for a clearly different name', async () => {
		await applyImport(db, untappd(), 'export.csv');
		await logDrink(db, {
			drink: { name: 'Something Else', producer: 'Fictional Fox Brewing' },
			venue: null,
			date: soonAfter
		});
		expect(await openReviews(db)).toEqual([]);
	});
});

describe('markVisited', () => {
	it('links an OpenStreetMap venue to history once', async () => {
		await markVisited(db, pub);
		await markVisited(db, pub);
		expect(await db.venues.toArray()).toEqual([
			expect.objectContaining({ name: 'The Corner Pub', lat: pub.lat, sourceKey: 'osm:node/103' })
		]);
		expect(await db.consumptions.count()).toBe(0);
	});

	it('reuses a nearby history venue with the same name', async () => {
		await applyImport(db, untappd(), 'export.csv');
		const venues = await db.venues.count();
		const v = await venueForPlace(db, taproom);
		expect(v.sourceKey).toBe('untappd:1001');
		await markVisited(db, taproom);
		expect(await db.venues.count()).toBe(venues);
	});
});

describe('type-ahead', () => {
	it('finds drinks by any words of the name or producer', async () => {
		await applyImport(db, untappd(), 'export.csv');
		const options = await drinkOptions(db);
		expect(filterOptions(options, 'marten').map((o) => o.name)).toContain('Marten Haze');
		expect(filterOptions(options, 'haze fox')[0]).toMatchObject({
			name: 'Marten Haze',
			producer: 'Fictional Fox Brewing Company'
		});
		expect(filterOptions(options, '')).toEqual([]);
		expect(filterOptions(options, 'zzzz')).toEqual([]);
	});

	it('ranks names that start with the query first', () => {
		const opts = ['Big Haze', 'Haze Lord', 'Hazelnut Porter'].map((name, id) => ({
			id,
			name,
			search: name.toLowerCase()
		}));
		expect(filterOptions(opts, 'haze').map((o) => o.name)).toEqual([
			'Haze Lord',
			'Hazelnut Porter',
			'Big Haze'
		]);
	});
});

describe('matching pasted names', () => {
	it('finds a history drink and venue despite case, punctuation and suffixes', async () => {
		await applyImport(db, untappd(), 'export.csv');
		const drinks = await drinkOptions(db);
		expect(matchDrink(drinks, 'MARTEN HAZE', 'Fictional Fox Brewing Co.')).toMatchObject({
			name: 'Marten Haze'
		});
		expect(matchDrink(drinks, 'Marten Haze', 'Other Brewery')).toBeNull();
		const venues = await venueOptions(db);
		expect(matchVenue(venues, 'The Test Taproom')).toMatchObject({ name: 'Test Taproom' });
		expect(matchVenue(venues, 'Somewhere Else Entirely')).toBeNull();
	});
});

describe('dates', () => {
	it('round-trips device-local times with their offset', () => {
		const d = new Date(2026, 9, 22, 16, 20, 5);
		const iso = toLocalIso(d);
		expect(iso).toMatch(/^2026-10-22T16:20:05[+-]\d{2}:\d{2}$/);
		expect(dateToTimestamp(iso)).toBe(d.getTime());
		expect(toDateTimeLocal(d)).toBe('2026-10-22T16:20');
		expect(fromDateTimeLocal('2026-10-22T16:20')).toBe(toLocalIso(new Date(2026, 9, 22, 16, 20)));
		expect(fromDateTimeLocal('')).toBeNull();
	});
});
