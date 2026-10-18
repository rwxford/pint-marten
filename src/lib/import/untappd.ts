import { categorize, hasNaWording, isNonAlcoholic } from './category';
import { cleanString } from './normalize';
import type { ImportRecord, ParsedImport, RowError } from './types';
import { parseAbv, parseCoords, parseDate, parseRating } from './values';

/** Columns that identify an Untappd check-in export (CSV header or JSON object keys). */
const SIGNATURE = ['checkin_id', 'bid', 'beer_name', 'brewery_name', 'brewery_id'];

export function looksLikeUntappd(keys: readonly string[]): boolean {
	const set = new Set(keys.map((k) => k.trim()));
	return SIGNATURE.every((k) => set.has(k));
}

type Row = Record<string, unknown>;

/**
 * Converts Untappd export rows (from CSV or JSON) into import records.
 *
 * Only what the app uses is kept. Comments, photos, tagged friends, toasts and URLs are dropped.
 * Untappd quirks handled here:
 * - `beer_abv` of 0 is ambiguous: real 0.0% beers ("Heineken 0.0") and beers whose ABV was never
 *   entered both appear as 0. It's kept as 0 only when the name or style says non-alcoholic;
 *   otherwise it's treated as unknown.
 * - `venue_id` of 0 means no venue was tagged.
 */
export function parseUntappdRows(rows: readonly Row[]): ParsedImport {
	const records: ImportRecord[] = [];
	const errors: RowError[] = [];

	rows.forEach((row, i) => {
		const rowNumber = i + 1;
		const checkinId = cleanString(row.checkin_id);
		const name = cleanString(row.beer_name);
		const producerName = cleanString(row.brewery_name);
		if (!checkinId || !name || !producerName) {
			errors.push({ row: rowNumber, message: 'Missing check-in ID, drink name or brewery name' });
			return;
		}

		const style = cleanString(row.beer_type, 100);
		const rawAbv = parseAbv(row.beer_abv);
		const abv = rawAbv === 0 && !hasNaWording(style, name) ? null : rawAbv;

		const venueId = cleanString(row.venue_id);
		const venueName = cleanString(row.venue_name);
		const coords = parseCoords(row.venue_lat, row.venue_lng);
		const venue =
			venueId && venueId !== '0' && venueName
				? {
						name: venueName,
						city: cleanString(row.venue_city, 100),
						region: cleanString(row.venue_state, 100),
						country: cleanString(row.venue_country, 100),
						lat: coords?.lat ?? null,
						lng: coords?.lng ?? null,
						sourceId: venueId
					}
				: null;

		records.push({
			sourceRowId: checkinId,
			drink: {
				name,
				style,
				abv,
				category: categorize(style, name),
				isNA: isNonAlcoholic(abv, style, name),
				sourceId: cleanString(row.bid)
			},
			producer: {
				name: producerName,
				city: cleanString(row.brewery_city, 100),
				region: cleanString(row.brewery_state, 100),
				country: cleanString(row.brewery_country, 100),
				sourceId: cleanString(row.brewery_id)
			},
			venue,
			date: parseDate(cleanString(row.created_at)),
			rating: parseRating(row.rating_score),
			servingType: cleanString(row.serving_type, 40)
		});
	});

	return { source: 'untappd', records, errors };
}
