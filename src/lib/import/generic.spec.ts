import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, missingRequired } from './generic';

const headers = ['Beer', 'Brewery', 'Style', 'ABV', 'Location', 'City', 'Date', 'Rating'];
const rows = [
	[
		'Marten Haze',
		'Fictional Fox Brewing',
		'IPA',
		'6.8%',
		'Test Taproom',
		'Raleigh',
		'16/05/2024',
		'4.5'
	],
	['Riverbend Red', 'Hypothetical Ales', '', '', '', '', '03/07/2024', ''],
	['Riverbend Red', 'Hypothetical Ales', '', '', '', '', '03/07/2024', ''],
	['', '', '', '', '', '', '', ''],
	['Ghost Row', '', 'Stout', '', '', '', '', '']
];

describe('guessMapping', () => {
	it('maps common header names', () => {
		const m = guessMapping(headers);
		expect(m).toMatchObject({
			drink: 0,
			producer: 1,
			style: 2,
			abv: 3,
			venue: 4,
			city: 5,
			date: 6,
			rating: 7
		});
		expect(m.lat).toBeNull();
		expect(missingRequired(m)).toEqual([]);
	});

	it('handles snake_case and reports missing required fields', () => {
		const m = guessMapping(['beer_name', 'venue_lat', 'venue_lng']);
		expect(m.drink).toBe(0);
		expect(m.lat).toBe(1);
		expect(m.lng).toBe(2);
		expect(missingRequired(m)).toEqual(['Brewery / cidery / meadery']);
	});
});

describe('applyMapping', () => {
	const mapping = guessMapping(headers);
	const result = applyMapping(rows, mapping, { dateOrder: 'dmy' });

	it('builds records and skips blank rows', () => {
		expect(result.records).toHaveLength(3);
		expect(result.records[0]).toMatchObject({
			drink: { name: 'Marten Haze', abv: 6.8, category: 'beer', sourceId: null },
			producer: { name: 'Fictional Fox Brewing' },
			venue: { name: 'Test Taproom', city: 'Raleigh', lat: null },
			date: '2024-05-16',
			rating: 4.5
		});
		expect(result.records[1].venue).toBeNull();
	});

	it('reports rows missing required values', () => {
		expect(result.errors).toEqual([{ row: 5, message: 'Missing drink name or producer' }]);
	});

	it('keeps repeated identical rows as separate, stable records', () => {
		const [, a, b] = result.records;
		expect(a.sourceRowId).not.toBe(b.sourceRowId);
		const again = applyMapping(rows, mapping, { dateOrder: 'dmy' });
		expect(again.records.map((r) => r.sourceRowId)).toEqual(
			result.records.map((r) => r.sourceRowId)
		);
	});

	it('flags dates it cannot read without dropping the row', () => {
		const r = applyMapping([['A', 'B', '', '', '', '', 'someday', '']], mapping, {
			dateOrder: 'mdy'
		});
		expect(r.records[0].date).toBeNull();
		expect(r.errors[0].message).toContain('someday');
	});

	it('honors an explicit category column', () => {
		const m = guessMapping(['Drink', 'Producer', 'Category']);
		const r = applyMapping([['Plain', 'Maker', 'Cider']], m, { dateOrder: 'mdy' });
		expect(r.records[0].drink.category).toBe('cider');
	});
});

describe('row fingerprints', () => {
	const m = guessMapping(['Beer', 'Brewery', 'Location', 'City', 'Date']);
	const opts = { dateOrder: 'mdy' as const };

	it('tell apart same-named venues in different places', () => {
		const a = applyMapping([['Lager', 'Maker', 'Taproom', 'Raleigh', '5/1/2024']], m, opts);
		const b = applyMapping([['Lager', 'Maker', 'Taproom', 'Denver', '5/1/2024']], m, opts);
		expect(a.records[0].sourceRowId).not.toBe(b.records[0].sourceRowId);
	});

	it('tell apart coordinates when names match', () => {
		const mc = guessMapping(['Beer', 'Brewery', 'Location', 'Lat', 'Lng']);
		const a = applyMapping([['Lager', 'Maker', 'Taproom', '35.1', '-78.1']], mc, opts);
		const b = applyMapping([['Lager', 'Maker', 'Taproom', '39.7', '-104.9']], mc, opts);
		expect(a.records[0].sourceRowId).not.toBe(b.records[0].sourceRowId);
	});
});
