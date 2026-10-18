import type { Bbox } from './types';

/**
 * Venue searches are cached per grid cell (0.05° ≈ 5.5 km north–south), so panning around an
 * area already searched doesn't hit the network again.
 */
export const CELL_DEGREES = 0.05;

/** Upper bound on cells per search, roughly 20 km × 20 km at mid latitudes. */
export const MAX_CELLS_PER_SEARCH = 25;

const index = (deg: number) => Math.floor(deg / CELL_DEGREES + 1e-9);

export function cellId(lat: number, lng: number): string {
	return `${index(lat)}:${index(lng)}`;
}

export function cellsForBbox(b: Bbox): string[] {
	const cells: string[] = [];
	for (let y = index(b.south); y <= index(b.north); y++) {
		for (let x = index(b.west); x <= index(b.east); x++) cells.push(`${y}:${x}`);
	}
	return cells;
}

export function cellBbox(id: string): Bbox {
	const [y, x] = id.split(':').map(Number);
	const round = (n: number) => Math.round(n * 1e6) / 1e6;
	return {
		south: round(y * CELL_DEGREES),
		west: round(x * CELL_DEGREES),
		north: round((y + 1) * CELL_DEGREES),
		east: round((x + 1) * CELL_DEGREES)
	};
}

/** Smallest box containing all the given cells. */
export function unionBbox(cells: string[]): Bbox {
	const boxes = cells.map(cellBbox);
	return {
		south: Math.min(...boxes.map((b) => b.south)),
		west: Math.min(...boxes.map((b) => b.west)),
		north: Math.max(...boxes.map((b) => b.north)),
		east: Math.max(...boxes.map((b) => b.east))
	};
}

export function inBbox(lat: number, lng: number, b: Bbox): boolean {
	return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}
