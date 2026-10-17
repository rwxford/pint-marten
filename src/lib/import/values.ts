/** Parsers for loosely formatted cell values. Each returns null for blank or invalid input. */

export function parseNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string') return null;
	const s = value.trim().replace(/%$/, '').replace(',', '.');
	if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
	return Number(s);
}

export function parseAbv(value: unknown): number | null {
	const n = parseNumber(value);
	return n !== null && n >= 0 && n <= 100 ? n : null;
}

export function parseRating(value: unknown): number | null {
	const n = parseNumber(value);
	return n !== null && n >= 0 && n <= 5 ? n : null;
}

/** Latitude/longitude pair; (0, 0) and out-of-range values are treated as missing. */
export function parseCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
	const la = parseNumber(lat);
	const lo = parseNumber(lng);
	if (la === null || lo === null) return null;
	if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
	if (la === 0 && lo === 0) return null;
	return { lat: la, lng: lo };
}

export type DateOrder = 'mdy' | 'dmy';

const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASHED =
	/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parses ISO 8601 or slashed dates (M/D/Y or D/M/Y). Returns ISO 8601; dates without a time
 * stay date-only so no time zone is invented.
 */
export function parseDate(value: unknown, order: DateOrder = 'mdy'): string | null {
	if (typeof value !== 'string') return null;
	const s = value.trim();
	if (!s) return null;

	if (ISO.test(s)) {
		const iso = s.replace(' ', 'T');
		return Number.isNaN(Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) ? null : iso;
	}

	const m = SLASHED.exec(s);
	if (!m) return null;
	const [, a, b, y, hh, mm, ss] = m;
	const month = Number(order === 'mdy' ? a : b);
	const day = Number(order === 'mdy' ? b : a);
	const year = y.length === 2 ? 2000 + Number(y) : Number(y);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const check = new Date(Date.UTC(year, month - 1, day));
	if (check.getUTCMonth() !== month - 1) return null;

	const date = `${year}-${pad(month)}-${pad(day)}`;
	return hh ? `${date}T${pad(Number(hh))}:${mm}:${ss ?? '00'}` : date;
}

/** Guesses day/month order from sample values: any first part above 12 means D/M/Y. */
export function guessDateOrder(samples: string[]): DateOrder {
	for (const s of samples) {
		const m = SLASHED.exec(s.trim());
		if (m && Number(m[1]) > 12) return 'dmy';
	}
	return 'mdy';
}

/** Milliseconds since the epoch for sorting; date-only values sort as UTC midnight. */
export function dateToTimestamp(iso: string | null): number | null {
	if (!iso) return null;
	const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
	return Number.isNaN(t) ? null : t;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}
