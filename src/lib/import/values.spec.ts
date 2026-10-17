import { describe, expect, it } from 'vitest';
import {
	dateToTimestamp,
	guessDateOrder,
	parseAbv,
	parseCoords,
	parseDate,
	parseNumber,
	parseRating
} from './values';

describe('numbers', () => {
	it('parses loose numeric text', () => {
		expect(parseNumber('6.8%')).toBe(6.8);
		expect(parseNumber('6,8')).toBe(6.8);
		expect(parseNumber(' 12 ')).toBe(12);
		expect(parseNumber('abc')).toBeNull();
		expect(parseNumber('')).toBeNull();
		expect(parseNumber(Number.NaN)).toBeNull();
	});

	it('bounds ABV and ratings', () => {
		expect(parseAbv('101')).toBeNull();
		expect(parseAbv(0)).toBe(0);
		expect(parseRating('4.25')).toBe(4.25);
		expect(parseRating('6')).toBeNull();
	});

	it('rejects missing, out-of-range and null-island coordinates', () => {
		expect(parseCoords('35.7796', '-78.6382')).toEqual({ lat: 35.7796, lng: -78.6382 });
		expect(parseCoords('', '')).toBeNull();
		expect(parseCoords(0, 0)).toBeNull();
		expect(parseCoords(91, 0)).toBeNull();
		expect(parseCoords(10, 181)).toBeNull();
	});
});

describe('parseDate', () => {
	it('keeps ISO 8601 with its offset', () => {
		expect(parseDate('2024-05-16T17:19:44-04:00')).toBe('2024-05-16T17:19:44-04:00');
		expect(parseDate('2025-07-04T21:00:00+02:00')).toBe('2025-07-04T21:00:00+02:00');
		expect(parseDate('2024-05-16 17:19:44')).toBe('2024-05-16T17:19:44');
		expect(parseDate('2024-05-16')).toBe('2024-05-16');
	});

	it('reads slashed dates in either order', () => {
		expect(parseDate('5/16/2024')).toBe('2024-05-16');
		expect(parseDate('16/05/2024', 'dmy')).toBe('2024-05-16');
		expect(parseDate('16.05.24', 'dmy')).toBe('2024-05-16');
		expect(parseDate('5/16/2024 9:05')).toBe('2024-05-16T09:05:00');
	});

	it('rejects impossible dates and junk', () => {
		expect(parseDate('2/30/2024')).toBeNull();
		expect(parseDate('16/05/2024', 'mdy')).toBeNull();
		expect(parseDate('yesterday')).toBeNull();
		expect(parseDate('')).toBeNull();
	});

	it('guesses day-first order from samples', () => {
		expect(guessDateOrder(['01/02/2024', '16/05/2024'])).toBe('dmy');
		expect(guessDateOrder(['01/02/2024', '05/16/2024'])).toBe('mdy');
	});

	it('produces sortable timestamps', () => {
		expect(dateToTimestamp('2024-05-16')).toBe(Date.UTC(2024, 4, 16));
		expect(dateToTimestamp('2024-05-16T17:19:44-04:00')).toBe(Date.UTC(2024, 4, 16, 21, 19, 44));
		expect(dateToTimestamp(null)).toBeNull();
	});
});
