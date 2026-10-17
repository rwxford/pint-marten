import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseImportText } from '../import/file';
import { applyMapping, guessMapping } from '../import/generic';
import type { ParsedImport } from '../import/types';
import { applyImport } from './apply';
import { openDatabase, type PintMartenDB } from './db';
import { keepSeparate, mergeReview, openReviews } from './review';
import { deleteAllData, getStats } from './stats';

function untappd(file: string): ParsedImport {
	const result = parseImportText(readFileSync(`tests/fixtures/${file}`, 'utf8'), file);
	if (result.kind !== 'records') throw new Error('expected records');
	return result.parsed;
}

function generic(): ParsedImport {
	const result = parseImportText(
		readFileSync('tests/fixtures/generic-sample.csv', 'utf8'),
		'g.csv'
	);
	if (result.kind !== 'table') throw new Error('expected table');
	return applyMapping(result.rows, result.mapping, result.options);
}

let db: PintMartenDB;
let n = 0;
beforeEach(() => {
	db = openDatabase(`test-${n++}`);
});

describe('applyImport', () => {
	it('imports an Untappd export', async () => {
		const r = await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
		expect(r).toMatchObject({
			added: 8,
			duplicates: 0,
			newDrinks: 7,
			newProducers: 6,
			newVenues: 3,
			reviewItems: 0
		});
		const stats = await getStats(db);
		expect(stats).toMatchObject({ consumptions: 8, drinks: 7, producers: 6, venues: 3 });
		expect(stats.byCategory).toEqual({ beer: 4, cider: 1, mead: 1, other: 1 });
		expect(stats.naDrinks).toBe(2);
	});

	it('is idempotent across re-imports and formats', async () => {
		await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
		const again = await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
		const json = await applyImport(db, untappd('untappd-sample.json'), 'export.json');
		expect(again).toMatchObject({ added: 0, duplicates: 8 });
		expect(json).toMatchObject({ added: 0, duplicates: 8, newDrinks: 0 });
		expect((await getStats(db)).consumptions).toBe(8);
	});

	it('matches spreadsheet rows to existing records by name and queues near-matches', async () => {
		await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
		const r = await applyImport(db, generic(), 'g.csv');
		// "Fictional Fox Brewing" matches "Fictional Fox Brewing Company"; "Marten Haze" is reused.
		expect(r).toMatchObject({ added: 4, newProducers: 1, newDrinks: 2, reviewItems: 1 });
		const reviews = await openReviews(db);
		expect(reviews).toHaveLength(1);
		expect(reviews[0]).toMatchObject({
			newName: 'Marten Hazey',
			candidateName: 'Marten Haze',
			context: 'Fictional Fox Brewing Company',
			newCount: 1,
			candidateCount: 3
		});
		// Re-importing the spreadsheet adds nothing and queues nothing new.
		expect(await applyImport(db, generic(), 'g.csv')).toMatchObject({ added: 0, reviewItems: 0 });
	});

	it('never asks about two records that both have source IDs', async () => {
		const parsed = untappd('untappd-sample.csv');
		const twin = structuredClone(parsed.records[0]);
		twin.sourceRowId = '99999';
		twin.drink.sourceId = '9999';
		twin.drink.name = 'Marten Hazey';
		const r = await applyImport(db, { ...parsed, records: [...parsed.records, twin] }, 'x.csv');
		expect(r.reviewItems).toBe(0);
	});

	it('fills in missing details from later sources', async () => {
		const m = guessMapping(['Beer', 'Brewery']);
		await applyImport(
			db,
			applyMapping([['Marten Haze', 'Fictional Fox']], m, { dateOrder: 'mdy' }),
			'g.csv'
		);
		await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
		const drinks = (await db.drinks.toArray()).filter((d) => d.key === 'marten haze');
		expect(drinks).toHaveLength(1);
		expect(drinks[0]).toMatchObject({
			abv: 6.8,
			style: 'IPA - New England / Hazy',
			sourceKey: 'untappd:501'
		});
		const producer = await db.producers.get(drinks[0].producerId);
		expect(producer?.sourceKey).toBe('untappd:301');
	});
});

describe('review queue', () => {
	beforeEach(async () => {
		await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
		await applyImport(db, generic(), 'g.csv');
	});

	it('merges a duplicate drink into the existing one', async () => {
		const [entry] = await openReviews(db);
		await mergeReview(db, entry.item.id);
		expect(await openReviews(db)).toEqual([]);
		const haze = await db.drinks.get(entry.item.candidateId);
		expect(await db.consumptions.where('drinkId').equals(haze!.id).count()).toBe(4);
		expect(await db.drinks.get(entry.item.newId)).toBeUndefined();
	});

	it('keeps records separate when asked', async () => {
		const [entry] = await openReviews(db);
		await keepSeparate(db, entry.item.id);
		expect(await openReviews(db)).toEqual([]);
		expect(await db.drinks.get(entry.item.newId)).toBeDefined();
	});

	it('merges producers, combining drinks with the same name', async () => {
		const m = guessMapping(['Beer', 'Brewery']);
		const rows = [
			['Marten Haze', 'Fictionall Fox'],
			['Brand New Beer', 'Fictionall Fox']
		];
		await applyImport(db, applyMapping(rows, m, { dateOrder: 'mdy' }), 'typo.csv');
		const producerReview = (await openReviews(db)).find((e) => e.item.kind === 'producer');
		expect(producerReview).toMatchObject({
			newName: 'Fictionall Fox',
			candidateName: 'Fictional Fox Brewing Company'
		});

		await mergeReview(db, producerReview!.item.id);
		const fox = await db.producers.get(producerReview!.item.candidateId);
		const foxDrinks = await db.drinks.where('producerId').equals(fox!.id).toArray();
		expect(foxDrinks.map((d) => d.name).sort()).toEqual([
			'Brand New Beer',
			'Marten Haze',
			'Marten Hazey'
		]);
		expect(await db.producers.get(producerReview!.item.newId)).toBeUndefined();
	});
});

it('deletes all data', async () => {
	await applyImport(db, untappd('untappd-sample.csv'), 'export.csv');
	await deleteAllData(db);
	expect((await getStats(db)).consumptions).toBe(0);
	expect(await db.importJobs.count()).toBe(0);
});
