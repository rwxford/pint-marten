import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type PintMartenDB } from '../data/db';
import {
	addCustomVenue,
	asVenue,
	customVenuesIn,
	isCustom,
	poiKind,
	removeCustomVenue,
	setCustomVisited
} from './custom';

let db: PintMartenDB;
let n = 0;
beforeEach(() => {
	db = openDatabase(`custom-${n++}`);
});

const fridays = { name: "TGI Friday's", kind: 'restaurant' as const, lat: 33.6405, lng: -84.4277 };

describe('poiKind', () => {
	it('maps OpenMapTiles classes to venue kinds', () => {
		expect(poiKind({ class: 'restaurant', subclass: 'restaurant' })).toBe('restaurant');
		expect(poiKind({ class: 'fast_food' })).toBe('restaurant');
		expect(poiKind({ class: 'bar', subclass: 'pub' })).toBe('pub');
		expect(poiKind({ class: 'cafe' })).toBe('cafe');
		expect(poiKind({ class: 'shop', subclass: 'alcohol' })).toBe('bottle_shop');
		expect(poiKind({ class: 'shop', subclass: 'clothes' })).toBe('other');
		expect(poiKind({})).toBe('other');
	});
});

describe('custom venues', () => {
	it('adds a place once, even if added again nearby', async () => {
		const first = await addCustomVenue(db, fridays, 1);
		expect(isCustom(first.id)).toBe(true);
		expect(first.visited).toBe(false);
		const again = await addCustomVenue(db, { ...fridays, name: 'TGI Fridays', lat: 33.6406 }, 2);
		expect(again.id).toBe(first.id);
		// Same name far away is another branch.
		const other = await addCustomVenue(db, { ...fridays, lat: 33.7 }, 3);
		expect(other.id).not.toBe(first.id);
		expect(await db.customVenues.count()).toBe(2);
	});

	it('rejects a place without a name', async () => {
		await expect(addCustomVenue(db, { ...fridays, name: '  ' })).rejects.toThrow();
	});

	it('finds places in an area, marks them visited and removes them', async () => {
		const v = await addCustomVenue(db, fridays);
		const box = { south: 33.63, west: -84.44, north: 33.65, east: -84.42 };
		expect((await customVenuesIn(db, box)).map((c) => c.id)).toEqual([v.id]);
		expect(await customVenuesIn(db, { ...box, west: -84.42, east: -84.4 })).toEqual([]);

		await setCustomVisited(db, v.id, true);
		expect((await customVenuesIn(db, box))[0].visited).toBe(true);

		await removeCustomVenue(db, v.id);
		expect(await customVenuesIn(db, box)).toEqual([]);
	});

	it('shapes an added place like an OSM venue', async () => {
		const v = asVenue(await addCustomVenue(db, fridays));
		expect(v).toMatchObject({ name: "TGI Friday's", kind: 'restaurant', lat: 33.6405 });
	});
});

describe('concurrent adds', () => {
	it('store one place when the same place is added twice at once', async () => {
		const [a, b] = await Promise.all([addCustomVenue(db, fridays), addCustomVenue(db, fridays)]);
		expect(a.id).toBe(b.id);
		expect(await db.customVenues.count()).toBe(1);
	});
});
