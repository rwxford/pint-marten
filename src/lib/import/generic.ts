import { categorize, isNonAlcoholic } from './category';
import { cleanString } from './normalize';
import type { Category, ImportRecord, ParsedImport, RowError } from './types';
import {
	guessDateOrder,
	parseAbv,
	parseCoords,
	parseDate,
	parseRating,
	type DateOrder
} from './values';

export const FIELDS = [
	{ key: 'drink', label: 'Drink name', required: true },
	{ key: 'producer', label: 'Brewery / cidery / meadery', required: true },
	{ key: 'style', label: 'Style', required: false },
	{ key: 'abv', label: 'ABV %', required: false },
	{ key: 'category', label: 'Category (beer/cider/mead)', required: false },
	{ key: 'venue', label: 'Venue name', required: false },
	{ key: 'city', label: 'Venue city', required: false },
	{ key: 'region', label: 'Venue state / region', required: false },
	{ key: 'country', label: 'Venue country', required: false },
	{ key: 'lat', label: 'Venue latitude', required: false },
	{ key: 'lng', label: 'Venue longitude', required: false },
	{ key: 'date', label: 'Date', required: false },
	{ key: 'rating', label: 'Rating (0–5)', required: false }
] as const;

export type FieldKey = (typeof FIELDS)[number]['key'];

/** Field → column index in the file, or null when not mapped. */
export type ColumnMapping = Record<FieldKey, number | null>;

export interface MappingOptions {
	dateOrder: DateOrder;
}

/** Header names (normalized) that suggest each field. First match wins. */
const SYNONYMS: Record<FieldKey, string[]> = {
	drink: ['beer', 'beer name', 'drink', 'drink name', 'name', 'cider', 'mead', 'product'],
	producer: ['brewery', 'brewery name', 'brewer', 'producer', 'maker', 'cidery', 'meadery'],
	style: ['style', 'beer style', 'type', 'beer type'],
	abv: ['abv', 'abv %', 'alcohol', 'alcohol %'],
	category: ['category', 'kind'],
	venue: ['venue', 'venue name', 'location', 'place', 'bar', 'where'],
	city: ['city', 'venue city', 'town'],
	region: ['state', 'region', 'province', 'venue state'],
	country: ['country', 'venue country'],
	lat: ['lat', 'latitude', 'venue lat', 'venue latitude'],
	lng: ['lng', 'lon', 'long', 'longitude', 'venue lng', 'venue lon', 'venue longitude'],
	date: ['date', 'created at', 'checkin date', 'when', 'timestamp', 'drank on'],
	rating: ['rating', 'score', 'rating score', 'stars']
};

function normalizeHeader(h: string): string {
	return h
		.toLowerCase()
		.replace(/[_\-.]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Auto-maps columns by header name. Each column is used at most once. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
	const normalized = headers.map(normalizeHeader);
	const used = new Set<number>();
	const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, null])) as ColumnMapping;
	for (const { key } of FIELDS) {
		for (const synonym of SYNONYMS[key]) {
			const index = normalized.findIndex((h, i) => h === synonym && !used.has(i));
			if (index !== -1) {
				mapping[key] = index;
				used.add(index);
				break;
			}
		}
	}
	return mapping;
}

export function guessOptions(rows: readonly string[][], mapping: ColumnMapping): MappingOptions {
	const col = mapping.date;
	const samples = col === null ? [] : rows.slice(0, 200).map((r) => r[col] ?? '');
	return { dateOrder: guessDateOrder(samples) };
}

export function missingRequired(mapping: ColumnMapping): string[] {
	return FIELDS.filter((f) => f.required && mapping[f.key] === null).map((f) => f.label);
}

function parseCategory(value: string | null): Category | null {
	const v = value?.toLowerCase();
	return v === 'beer' || v === 'cider' || v === 'mead' || v === 'other' ? v : null;
}

/** Stable ID from the mapped values, so re-importing the same spreadsheet adds nothing new. */
function rowFingerprint(parts: (string | number | null)[]): string {
	const s = parts.map((p) => (p === null ? '' : String(p))).join('␟');
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
		h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
	}
	return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function applyMapping(
	rows: readonly string[][],
	mapping: ColumnMapping,
	options: MappingOptions
): ParsedImport {
	const records: ImportRecord[] = [];
	const errors: RowError[] = [];
	// Identical rows can be real repeats (two pints of the same beer on the same day), so each
	// copy gets its own occurrence number. Re-importing the same file reproduces the same IDs.
	const occurrences = new Map<string, number>();
	const get = (row: string[], key: FieldKey) => {
		const i = mapping[key];
		return i === null ? null : cleanString(row[i]);
	};

	rows.forEach((row, i) => {
		const rowNumber = i + 1;
		const name = get(row, 'drink');
		const producerName = get(row, 'producer');
		if (!name || !producerName) {
			if (row.some((cell) => cell.trim())) {
				errors.push({ row: rowNumber, message: 'Missing drink name or producer' });
			}
			return;
		}

		const style = get(row, 'style');
		const abv = parseAbv(get(row, 'abv'));
		const category = parseCategory(get(row, 'category')) ?? categorize(style, name);
		const rawDate = get(row, 'date');
		const date = parseDate(rawDate, options.dateOrder);
		if (rawDate && !date) {
			errors.push({
				row: rowNumber,
				message: `Unrecognized date "${rawDate}" (imported without a date)`
			});
		}

		const venueName = get(row, 'venue');
		const coords = parseCoords(get(row, 'lat'), get(row, 'lng'));
		const venue = venueName
			? {
					name: venueName,
					city: get(row, 'city'),
					region: get(row, 'region'),
					country: get(row, 'country'),
					lat: coords?.lat ?? null,
					lng: coords?.lng ?? null,
					sourceId: null
				}
			: null;
		const rating = parseRating(get(row, 'rating'));

		const fingerprint = rowFingerprint([producerName, name, date, venueName, rating]);
		const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
		occurrences.set(fingerprint, occurrence);

		records.push({
			sourceRowId: occurrence === 1 ? fingerprint : `${fingerprint}#${occurrence}`,
			drink: {
				name,
				style,
				abv,
				category,
				isNA: isNonAlcoholic(abv, style, name),
				sourceId: null
			},
			producer: { name: producerName, city: null, region: null, country: null, sourceId: null },
			venue,
			date,
			rating,
			servingType: null
		});
	});

	return { source: 'generic', records, errors };
}
