import { cleanString } from '../import/normalize';
import { cellId } from './grid';
import type { Bbox, OsmVenue, VenueKind } from './types';

/**
 * Overpass QL for drinking venues in a box: bars, pubs and beer gardens; breweries, cideries
 * and wineries (some meaderies are tagged as wineries); and bottle shops. `out center` gives
 * buildings (ways) a single point.
 */
export function buildOverpassQuery(b: Bbox): string {
	const box = [b.south, b.west, b.north, b.east].map((n) => n.toFixed(5)).join(',');
	return [
		'[out:json][timeout:25];',
		'(',
		`  nwr["amenity"~"^(bar|pub|biergarten)$"](${box});`,
		`  nwr["craft"~"^(brewery|cider|winery|meadery)$"](${box});`,
		`  nwr["microbrewery"="yes"](${box});`,
		`  nwr["shop"~"^(alcohol|beverages)$"](${box});`,
		');',
		'out center tags;'
	].join('\n');
}

interface OverpassElement {
	type: string;
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
}

const MEAD = /\bmead/i;
const CIDER = /\bcider/i;

export function venueKind(tags: Record<string, string>): VenueKind | null {
	const name = tags.name ?? '';
	const craft = tags.craft;
	if (craft === 'meadery' || (craft === 'winery' && MEAD.test(name))) return 'meadery';
	if (craft === 'cider' || (craft === 'winery' && CIDER.test(name))) return 'cidery';
	if (craft === 'brewery' || tags.microbrewery === 'yes') return 'brewery';
	if (tags.amenity === 'pub') return 'pub';
	if (tags.amenity === 'biergarten') return 'biergarten';
	if (tags.amenity === 'bar') return 'bar';
	if (tags.shop === 'alcohol' || tags.shop === 'beverages') return 'bottle_shop';
	return null;
}

/** Converts an Overpass JSON response to venues. Unnamed and unrecognized features are dropped. */
export function parseOverpass(data: unknown): OsmVenue[] {
	const elements = (data as { elements?: unknown })?.elements;
	if (!Array.isArray(elements)) throw new Error('Unexpected Overpass response');
	const venues: OsmVenue[] = [];
	for (const el of elements as OverpassElement[]) {
		const tags = el?.tags;
		if (!tags || !['node', 'way', 'relation'].includes(el.type)) continue;
		const lat = el.lat ?? el.center?.lat;
		const lng = el.lon ?? el.center?.lon;
		const name = cleanString(tags.name, 120);
		const kind = venueKind(tags);
		if (!name || !kind || typeof lat !== 'number' || typeof lng !== 'number') continue;
		venues.push({
			osmId: `${el.type}/${el.id}`,
			name,
			kind,
			lat,
			lng,
			openingHours: cleanString(tags.opening_hours, 200),
			website: safeHttpUrl(tags.website ?? tags['contact:website']),
			cell: cellId(lat, lng)
		});
	}
	return venues;
}

/** Only http(s) links are kept, so a crafted tag can't become a javascript: link. */
function safeHttpUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

export class OverpassError extends Error {
	constructor(
		message: string,
		readonly busy: boolean
	) {
		super(message);
	}
}

/** Queries the Overpass API. Only the bounding box is sent. */
export async function fetchOverpass(
	b: Bbox,
	endpoint: string,
	fetchFn: typeof fetch = fetch
): Promise<OsmVenue[]> {
	const res = await fetchFn(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `data=${encodeURIComponent(buildOverpassQuery(b))}`,
		credentials: 'omit',
		referrerPolicy: 'no-referrer'
	});
	if (res.status === 429 || res.status === 504) {
		throw new OverpassError('The venue search service is busy. Try again in a minute.', true);
	}
	if (!res.ok) throw new OverpassError(`Venue search failed (${res.status}).`, false);
	return parseOverpass(await res.json());
}
