import { describe, expect, it } from 'vitest';
import { nearestToTap } from './hit.ts';

describe('nearestToTap', () => {
	const dots = [
		{ id: 'a', x: 100, y: 100 },
		{ id: 'b', x: 112, y: 100 }
	];

	it('picks the closest dot within the tap radius', () => {
		expect(nearestToTap({ x: 109, y: 104 }, dots)?.id).toBe('b');
		expect(nearestToTap({ x: 85, y: 110 }, dots)?.id).toBe('a');
	});

	it('ignores dots outside the radius', () => {
		expect(nearestToTap({ x: 160, y: 100 }, dots)).toBeNull();
		expect(nearestToTap({ x: 100, y: 130 }, dots, 20)).toBeNull();
	});
});
