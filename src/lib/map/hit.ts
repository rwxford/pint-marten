/** How far from a tap, in CSS pixels, a venue dot still counts as tapped. Fingers are ~40px wide. */
export const TAP_RADIUS_PX = 22;

export interface ScreenPoint {
	x: number;
	y: number;
}

/**
 * The candidate closest to the tap, if any lies within `radius` pixels. Dots are small, so
 * picking the nearest one in a finger-sized area beats requiring an exact hit.
 */
export function nearestToTap<T extends ScreenPoint>(
	tap: ScreenPoint,
	candidates: readonly T[],
	radius = TAP_RADIUS_PX
): T | null {
	let best: T | null = null;
	let bestDistance = radius * radius;
	for (const c of candidates) {
		const d = (c.x - tap.x) ** 2 + (c.y - tap.y) ** 2;
		if (d <= bestDistance) {
			best = c;
			bestDistance = d;
		}
	}
	return best;
}
