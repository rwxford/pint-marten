import { describe, expect, it } from 'vitest';
import { distanceMeters, venueMatchKey, visitedOsmIds } from './match';
import type { OsmVenue } from './types';

const osm = (osmId: string, name: string, lat: number, lng: number): OsmVenue => ({
	osmId,
	name,
	kind: 'bar',
	lat,
	lng,
	openingHours: null,
	website: null,
	cell: ''
});

describe('distanceMeters', () => {
	it('is roughly right for short distances', () => {
		// 0.001° of latitude ≈ 111 m.
		expect(distanceMeters(35, -78, 35.001, -78)).toBeCloseTo(111, 0);
	});
});

describe('venueMatchKey', () => {
	it('ignores generic venue words', () => {
		expect(venueMatchKey('Fictional Fox Brewing Company Taproom')).toBe('fictional fox');
		expect(venueMatchKey('The Pub')).toBe('the pub');
	});
});

describe('visitedOsmIds', () => {
	const places = [
		osm('node/1', 'Test Taproom', 35.7797, -78.6381),
		osm('node/2', 'Fictional Fox Brewing Company', 35.781, -78.64),
		osm('node/3', 'The Corner Pub', 35.7775, -78.6355),
		osm('node/4', 'Far Away Taproom', 35.9, -78.9)
	];

	it('matches nearby venues with the same or similar name', () => {
		const visited = visitedOsmIds(places, [
			{ name: 'Test Taproom', lat: 35.7796, lng: -78.6382 },
			// Untappd-style longer name for the same place, ~40 m away.
			{ name: 'Fictional Fox Brewing Co. Taproom & Kitchen', lat: 35.7813, lng: -78.6402 }
		]);
		expect([...visited].sort()).toEqual(['node/1', 'node/2']);
	});

	it('requires both closeness and a name match', () => {
		const visited = visitedOsmIds(places, [
			// Right name, ~250 m away.
			{ name: 'The Corner Pub', lat: 35.7798, lng: -78.6355 },
			// Right spot, different place.
			{ name: 'Sushi Palace', lat: 35.7797, lng: -78.6381 }
		]);
		expect(visited.size).toBe(0);
	});

	it('does not let very short names match by containment', () => {
		const visited = visitedOsmIds(
			[osm('node/9', 'Joe’s Bar and Grill', 35, -78)],
			[{ name: 'J', lat: 35, lng: -78 }]
		);
		expect(visited.size).toBe(0);
	});
});
