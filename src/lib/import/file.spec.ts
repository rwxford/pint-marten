import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ROWS, parseImportText } from './file';

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');

describe('Untappd exports', () => {
	const csv = parseImportText(fixture('untappd-sample.csv'), 'export.csv');
	const json = parseImportText(fixture('untappd-sample.json'), 'export.json');

	it('detects both formats', () => {
		expect(csv.kind).toBe('records');
		expect(json.kind).toBe('records');
	});

	it('parses CSV and JSON to identical records', () => {
		if (csv.kind !== 'records' || json.kind !== 'records') throw new Error('not records');
		expect(csv.parsed.records).toHaveLength(8);
		expect(csv.parsed.errors).toEqual([]);
		expect(json.parsed.records).toEqual(csv.parsed.records);
	});

	it('applies Untappd quirks', () => {
		if (csv.kind !== 'records') throw new Error('not records');
		const byId = new Map(csv.parsed.records.map((r) => [r.sourceRowId, r]));
		// Quoted comment with commas and a newline doesn't break the row.
		expect(byId.get('90001')?.drink.name).toBe('Marten Haze');
		// venue_id 0 means no venue.
		expect(byId.get('90002')?.venue).toBeNull();
		// ABV 0 is unknown, not non-alcoholic.
		expect(byId.get('90003')?.drink).toMatchObject({ abv: null, isNA: false });
		// Real NA beers have a small positive ABV.
		expect(byId.get('90004')?.drink).toMatchObject({ abv: 0.4, isNA: true, category: 'beer' });
		expect(byId.get('90004')?.rating).toBeNull();
		expect(byId.get('90005')?.drink.category).toBe('cider');
		expect(byId.get('90006')?.drink.category).toBe('mead');
		expect(byId.get('90007')?.drink).toMatchObject({ category: 'other', isNA: true });
		expect(byId.get('90008')?.drink.name).toBe('Øl Nummer Én');
		expect(byId.get('90005')?.date).toBe('2025-07-04T21:00:00+02:00');
	});

	it('drops fields the app does not use', () => {
		if (csv.kind !== 'records') throw new Error('not records');
		const text = JSON.stringify(csv.parsed.records);
		expect(text).not.toContain('Juicy');
		expect(text).not.toContain('friend_a');
		expect(text).not.toContain('untappd.com');
	});
});

describe('other files', () => {
	it('returns a table with a guessed mapping for generic CSVs', () => {
		const result = parseImportText(fixture('generic-sample.csv'), 'mine.csv');
		expect(result.kind).toBe('table');
		if (result.kind !== 'table') return;
		expect(result.headers[0]).toBe('Beer');
		expect(result.mapping.drink).toBe(0);
		expect(result.mapping.producer).toBe(1);
		expect(result.mapping.venue).toBe(4);
		expect(result.options.dateOrder).toBe('dmy');
	});

	it('reads tab-separated files', () => {
		const result = parseImportText('Beer\tBrewery\nA\tB\n', 'mine.tsv');
		expect(result.kind).toBe('table');
		if (result.kind === 'table') expect(result.rows).toEqual([['A', 'B']]);
	});

	it.each([
		['', 'x.csv', 'empty'],
		['Beer,Brewery\n', 'x.csv', 'header row'],
		['{not json', 'x.json', 'could not be read'],
		['[{"name":"x"}]', 'x.json', 'Only Untappd']
	])('rejects bad input %#', (text, name, message) => {
		const result = parseImportText(text, name);
		expect(result.kind).toBe('error');
		if (result.kind === 'error') expect(result.message).toContain(message);
	});

	it('limits row count', () => {
		const text = 'Beer,Brewery\n' + 'a,b\n'.repeat(MAX_ROWS + 1);
		const result = parseImportText(text, 'big.csv');
		expect(result.kind).toBe('error');
	});
});
