import { describe, expect, it } from 'vitest';
import { cellBbox, cellId, cellsForBbox, countCells, inBbox, unionBbox } from './grid';

describe('grid', () => {
	it('maps points to stable cells, including negative coordinates', () => {
		expect(cellId(35.7796, -78.6382)).toBe('715:-1573');
		expect(cellId(0.0001, 0.0001)).toBe('0:0');
		expect(cellId(-0.0001, -0.0001)).toBe('-1:-1');
	});

	it('round-trips cell boxes', () => {
		const b = cellBbox('715:-1573');
		expect(b).toEqual({ south: 35.75, west: -78.65, north: 35.8, east: -78.6 });
		expect(inBbox(35.7796, -78.6382, b)).toBe(true);
	});

	it('covers a box with every overlapping cell', () => {
		const cells = cellsForBbox({ south: 35.76, west: -78.66, north: 35.81, east: -78.61 });
		expect(cells.sort()).toEqual(['715:-1574', '715:-1573', '716:-1574', '716:-1573'].sort());
		expect(unionBbox(cells)).toEqual({ south: 35.75, west: -78.7, north: 35.85, east: -78.6 });
	});
});

describe('countCells', () => {
	it('matches the enumerated list for small boxes', () => {
		const b = { south: 35.76, west: -78.66, north: 35.81, east: -78.61 };
		expect(countCells(b)).toBe(cellsForBbox(b).length);
	});

	it('counts huge areas without enumerating them', () => {
		const world = { south: -85, west: -180, north: 85, east: 180 };
		const started = performance.now();
		expect(countCells(world)).toBeGreaterThan(20_000_000);
		expect(performance.now() - started).toBeLessThan(5);
	});

	it('treats inverted boxes as empty', () => {
		expect(countCells({ south: 1, west: 1, north: 0, east: 0 })).toBe(0);
	});
});
