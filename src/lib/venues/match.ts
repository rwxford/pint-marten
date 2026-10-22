import { normalizeText, similarity } from '../import/normalize';
import type { OsmVenue } from './types';

/** Imported venues must be this close to an OpenStreetMap venue to count as the same place. */
export const MATCH_RADIUS_M = 150;
export const NAME_THRESHOLD = 0.6;

const VENUE_WORDS =
	/\b(the|brewing|brewery|brewpub|brewhouse|beer|company|co|taproom|tap room|tasting room|bar|pub|tavern|and|cidery|meadery|kitchen|restaurant)\b/g;

/** Name used for venue matching: generic words like "Taproom" or "Brewing Co." are ignored. */
export function venueMatchKey(name: string): string {
	const key = normalizeText(name).replace(VENUE_WORDS, ' ').replace(/\s+/g, ' ').trim();
	return key || normalizeText(name);
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6_371_000;
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLng = (lng2 - lng1) * rad;
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

/** Containment only counts for keys of 4+ characters, so "j" doesn't match everything. */
function namesMatch(a: string, b: string): boolean {
	if (a === b) return true;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	if (short.length >= 4 && long.includes(short)) return true;
	return similarity(a, b) >= NAME_THRESHOLD;
}

export interface KnownVenue {
	name: string;
	lat: number;
	lng: number;
}

/**
 * Returns the IDs of OpenStreetMap venues the user has visited: an imported venue within 150 m
 * whose name matches (similar, or one contains the other, ignoring generic words).
 */
export function visitedOsmIds(osm: readonly OsmVenue[], known: readonly KnownVenue[]): Set<string> {
	// Bucket known venues by ~1 km so each lookup only checks nearby ones.
	const bucket = (lat: number, lng: number) => `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`;
	const buckets = new Map<string, { v: KnownVenue; key: string }[]>();
	for (const v of known) {
		const b = bucket(v.lat, v.lng);
		const list = buckets.get(b) ?? [];
		list.push({ v, key: venueMatchKey(v.name) });
		buckets.set(b, list);
	}

	const visited = new Set<string>();
	for (const o of osm) {
		const key = venueMatchKey(o.name);
		const by = Math.floor(o.lat * 100);
		const bx = Math.floor(o.lng * 100);
		search: for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				for (const { v, key: k } of buckets.get(`${by + dy}:${bx + dx}`) ?? []) {
					if (distanceMeters(o.lat, o.lng, v.lat, v.lng) > MATCH_RADIUS_M) continue;
					if (namesMatch(k, key)) {
						visited.add(o.osmId);
						break search;
					}
				}
			}
		}
	}
	return visited;
}
