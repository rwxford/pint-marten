export type VenueKind =
	| 'brewery'
	| 'cidery'
	| 'meadery'
	| 'pub'
	| 'bar'
	| 'biergarten'
	| 'bottle_shop'
	// Only for places you add yourself; the OpenStreetMap search never returns these.
	| 'restaurant'
	| 'cafe'
	| 'other';

export const VENUE_KIND_LABELS: Record<VenueKind, string> = {
	brewery: 'Brewery',
	cidery: 'Cidery',
	meadery: 'Meadery',
	pub: 'Pub',
	bar: 'Bar',
	biergarten: 'Beer garden',
	bottle_shop: 'Bottle shop',
	restaurant: 'Restaurant',
	cafe: 'Café',
	other: 'Place'
};

/** A drinking venue from OpenStreetMap. */
export interface OsmVenue {
	/** "node/123", "way/456" or "relation/789". */
	osmId: string;
	name: string;
	kind: VenueKind;
	lat: number;
	lng: number;
	openingHours: string | null;
	website: string | null;
	/** Grid cell this venue was cached under. */
	cell: string;
}

/** South, west, north, east in degrees. */
export interface Bbox {
	south: number;
	west: number;
	north: number;
	east: number;
}
