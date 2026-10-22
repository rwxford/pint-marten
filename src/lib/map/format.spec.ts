import { describe, expect, it } from 'vitest';
import { formatDistance, locationErrorMessage } from './format.ts';

describe('formatDistance', () => {
	it('uses feet under a tenth of a mile and miles above', () => {
		expect(formatDistance(50)).toBe('160 ft');
		expect(formatDistance(1609.344 * 2.34)).toBe('2.3 mi');
		expect(formatDistance(1609.344 * 12.6)).toBe('13 mi');
	});
});

describe('locationErrorMessage', () => {
	it('tells denied, unavailable and timed-out requests apart', () => {
		expect(locationErrorMessage({ code: 1 })).toMatch(/permission is off/);
		expect(locationErrorMessage({ code: 2 })).toMatch(/location services are on/);
		expect(locationErrorMessage({ code: 3 })).toMatch(/took too long/);
	});
});
