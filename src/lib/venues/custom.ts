import type { CustomVenue, PintMartenDB } from '../data/db';
import { cleanString, normalizeText } from '../import/normalize';
import { inBbox } from './grid';
import { distanceMeters } from './match';
import type { Bbox, OsmVenue, VenueKind } from './types';

/** Two adds of the same name this close together are the same place. */
const SAME_PLACE_METERS = 30;

/**
 * Venue kind for a point of interest on the base map. OpenFreeMap uses the OpenMapTiles schema,
 * whose `poi` layer has `class` and `subclass` properties.
 */
export function poiKind(props: { class?: unknown; subclass?: unknown }): VenueKind {
	const values = [props.subclass, props.class].filter((v) => typeof v === 'string');
	for (const v of values) {
		switch (v) {
			case 'pub':
				return 'pub';
			case 'bar':
			case 'beer':
				return 'bar';
			case 'biergarten':
				return 'biergarten';
			case 'brewery':
				return 'brewery';
			case 'alcohol_shop':
			case 'alcohol':
			case 'beverages':
				return 'bottle_shop';
			case 'restaurant':
			case 'fast_food':
			case 'food_court':
				return 'restaurant';
			case 'cafe':
				return 'cafe';
		}
	}
	return 'other';
}

export interface NewPlace {
	name: string;
	kind: VenueKind;
	lat: number;
	lng: number;
}

/** Saves a place on this device, or returns the existing one if it was already added. */
export async function addCustomVenue(
	db: PintMartenDB,
	place: NewPlace,
	now = Date.now()
): Promise<CustomVenue> {
	const name = cleanString(place.name, 120);
	if (!name) throw new Error('A place needs a name');
	const key = normalizeText(name);
	const existing = (await db.customVenues.toArray()).find(
		(c) =>
			normalizeText(c.name) === key &&
			distanceMeters(c.lat, c.lng, place.lat, place.lng) <= SAME_PLACE_METERS
	);
	if (existing) return existing;
	const venue: CustomVenue = {
		id: `custom/${crypto.randomUUID()}`,
		name,
		kind: place.kind,
		lat: place.lat,
		lng: place.lng,
		visited: false,
		addedAt: now
	};
	await db.customVenues.add(venue);
	return venue;
}

export async function customVenuesIn(db: PintMartenDB, b: Bbox): Promise<CustomVenue[]> {
	const rows = await db.customVenues.where('lat').between(b.south, b.north, true, true).toArray();
	return rows.filter((c) => inBbox(c.lat, c.lng, b));
}

export async function setCustomVisited(db: PintMartenDB, id: string, visited: boolean) {
	await db.customVenues.update(id, { visited });
}

export async function removeCustomVenue(db: PintMartenDB, id: string) {
	await db.customVenues.delete(id);
}

/** Shapes an added place like an OSM venue so the map and list treat both the same way. */
export function asVenue(c: CustomVenue): OsmVenue {
	return {
		osmId: c.id,
		name: c.name,
		kind: c.kind,
		lat: c.lat,
		lng: c.lng,
		openingHours: null,
		website: null,
		cell: ''
	};
}

export function isCustom(id: string): boolean {
	return id.startsWith('custom/');
}
