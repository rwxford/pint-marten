import { categorize, isNonAlcoholic } from '../import/category';
import { cleanString, drinkKey, normalizeText, producerKey, similarity } from '../import/normalize';
import type { Category } from '../import/types';
import { dateToTimestamp } from '../import/values';
import { isCustom, setCustomVisited } from '../venues/custom';
import { distanceMeters, MATCH_RADIUS_M, namesMatch, venueMatchKey } from '../venues/match';
import { aliasKey, DRINK_REVIEW_THRESHOLD, PRODUCER_REVIEW_THRESHOLD } from './apply';
import type { Drink, PintMartenDB, Producer, Venue } from './db';

/** File name of the standing import job that owns every drink logged in the app. */
export const MANUAL_JOB_NAME = 'Logged in app';

export const SERVING_TYPES = ['Draft', 'Can', 'Bottle', 'Taster', 'Growler', 'Cask'] as const;

/** A place on the map: an OpenStreetMap venue ("node/123") or one you added ("custom/<uuid>"). */
export interface MapPlace {
	ref: string;
	name: string;
	lat: number;
	lng: number;
}

export type DrinkInput =
	| { drinkId: number }
	| {
			name: string;
			producer: string;
			style?: string | null;
			abv?: number | null;
	  };

export type VenueInput = { place: MapPlace } | { venueId: number } | null;

export interface DrinkLog {
	drink: DrinkInput;
	venue: VenueInput;
	/** ISO 8601 with a UTC offset, like Untappd's `created_at`. */
	date: string;
	rating?: number | null;
	servingType?: string | null;
}

export interface LogResult {
	consumptionId: number;
	drinkId: number;
	venueId: number | null;
	/** True when the drink wasn't in your history before. */
	newDrink: boolean;
}

/** A drink from history, shaped for type-ahead. */
export interface DrinkOption {
	id: number;
	name: string;
	producer: string;
	style: string | null;
	category: Category;
	/** Normalized "name producer" for matching typed text. */
	search: string;
}

export interface VenueOption {
	id: number;
	name: string;
	city: string | null;
	search: string;
}

/** Formats a time as ISO 8601 in the device's time zone, e.g. "2026-10-22T16:20:00-04:00". */
export function toLocalIso(d: Date): string {
	const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
	const offset = -d.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${sign}${pad(offset / 60)}:${pad(offset % 60)}`
	);
}

/** The value a `datetime-local` input shows for a time, e.g. "2026-10-22T16:20". */
export function toDateTimeLocal(d: Date): string {
	return toLocalIso(d).slice(0, 16);
}

/** Reads a `datetime-local` value as device-local time; null when blank or invalid. */
export function fromDateTimeLocal(value: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : toLocalIso(d);
}

function sourceKeyFor(place: MapPlace): string {
	return isCustom(place.ref) ? `place:${place.ref}` : `osm:${place.ref}`;
}

/** The ID of the standing "Logged in app" job, created the first time it's needed. */
async function manualJobId(db: PintMartenDB): Promise<number> {
	const existing = await db.importJobs.filter((j) => j.source === 'manual').first();
	if (existing) return existing.id;
	return db.importJobs.add({
		source: 'manual',
		fileName: MANUAL_JOB_NAME,
		importedAt: new Date().toISOString(),
		added: 0,
		duplicates: 0,
		errors: 0
	});
}

/**
 * Finds the history venue for a map place, or creates one. A venue already linked to the place
 * wins; otherwise any venue with coordinates within 150 m and a matching name (the same rule
 * that marks map venues visited), so a drink logged at a venue you've checked into before
 * joins that venue.
 */
export async function venueForPlace(db: PintMartenDB, place: MapPlace): Promise<Venue> {
	const sk = sourceKeyFor(place);
	const linked = await db.venues.where('sourceKey').equals(sk).first();
	if (linked) return linked;

	const key = venueMatchKey(place.name);
	let best: { v: Venue; d: number } | null = null;
	for (const v of await db.venues.toArray()) {
		if (v.lat === null || v.lng === null) continue;
		const d = distanceMeters(place.lat, place.lng, v.lat, v.lng);
		if (d <= MATCH_RADIUS_M && namesMatch(venueMatchKey(v.name), key) && (!best || d < best.d))
			best = { v, d };
	}
	if (best) return best.v;

	const name = cleanString(place.name, 200) ?? 'Unnamed place';
	const fields: Omit<Venue, 'id'> = {
		name,
		nameKey: `${normalizeText(name)}|`,
		sourceKey: sk,
		city: null,
		region: null,
		country: null,
		lat: place.lat,
		lng: place.lng
	};
	return { id: await db.venues.add(fields), ...fields };
}

/**
 * Queues a review when a newly created record closely resembles an existing one, as an import
 * does, so a typo'd name can be merged later (and a later import's twin check-in dropped then).
 */
async function queueReviewIfSimilar<T extends { id: number; key: string }>(
	db: PintMartenDB,
	kind: 'drink' | 'producer',
	created: T,
	others: readonly T[],
	threshold: number
) {
	let best: { id: number; score: number } | null = null;
	for (const o of others) {
		if (o.id === created.id) continue;
		const score = similarity(created.key, o.key);
		if (score >= threshold && (!best || score > best.score)) best = { id: o.id, score };
	}
	if (!best) return;
	await db.reviewItems.add({
		kind,
		newId: created.id,
		candidateId: best.id,
		score: Math.round(best.score * 100) / 100,
		status: 'open',
		createdAt: new Date().toISOString()
	});
}

async function resolveProducer(db: PintMartenDB, name: string): Promise<Producer> {
	const key = producerKey(name);
	const direct = await db.producers.where('key').equals(key).first();
	if (direct) return direct;
	const alias = await db.aliases.get(aliasKey.producerName(key));
	const aliased = alias ? await db.producers.get(alias.targetId) : undefined;
	if (aliased) return aliased;
	const fields: Omit<Producer, 'id'> = {
		name,
		key,
		sourceKey: null,
		city: null,
		region: null,
		country: null
	};
	const created: Producer = { id: await db.producers.add(fields), ...fields };
	await queueReviewIfSimilar(
		db,
		'producer',
		created,
		await db.producers.toArray(),
		PRODUCER_REVIEW_THRESHOLD
	);
	return created;
}

async function resolveDrink(
	db: PintMartenDB,
	input: DrinkInput
): Promise<{ drink: Drink; created: boolean }> {
	if ('drinkId' in input) {
		const drink = await db.drinks.get(input.drinkId);
		if (!drink) throw new Error('That drink is no longer in your history');
		return { drink, created: false };
	}
	const name = cleanString(input.name);
	const producerName = cleanString(input.producer);
	if (!name || !producerName) throw new Error('A drink needs a name and a producer');
	const producer = await resolveProducer(db, producerName);
	const key = drinkKey(name);
	const direct = await db.drinks.where('[producerId+key]').equals([producer.id, key]).first();
	if (direct) return { drink: direct, created: false };
	const alias = await db.aliases.get(aliasKey.drinkName(producer.id, key));
	const aliased = alias ? await db.drinks.get(alias.targetId) : undefined;
	if (aliased) return { drink: aliased, created: false };

	const style = cleanString(input.style ?? null, 100);
	const abv = input.abv ?? null;
	const fields: Omit<Drink, 'id'> = {
		producerId: producer.id,
		name,
		key,
		sourceKey: null,
		style,
		abv,
		category: categorize(style, name),
		isNA: isNonAlcoholic(abv, style, name)
	};
	const drink: Drink = { id: await db.drinks.add(fields), ...fields };
	await queueReviewIfSimilar(
		db,
		'drink',
		drink,
		await db.drinks.where('producerId').equals(producer.id).toArray(),
		DRINK_REVIEW_THRESHOLD
	);
	return { drink, created: true };
}

/**
 * Records one drink you had, without an import file. Drinks and producers are matched by name
 * like an import would; new ones are created. The consumption belongs to the standing
 * "Logged in app" job and gets a `manual:<uuid>` row key, so a later import that contains the
 * same check-in can find and replace it.
 */
export async function logDrink(db: PintMartenDB, entry: DrinkLog): Promise<LogResult> {
	const date = entry.date;
	const ts = dateToTimestamp(date);
	if (ts === null) throw new Error('Invalid date');
	const rating = entry.rating ?? null;
	if (rating !== null && !(rating >= 0 && rating <= 5)) throw new Error('Rating must be 0–5');
	const abv = 'drinkId' in entry.drink ? null : (entry.drink.abv ?? null);
	if (abv !== null && !(abv >= 0 && abv <= 100)) throw new Error('ABV must be 0–100');

	const tables = [
		db.producers,
		db.drinks,
		db.venues,
		db.consumptions,
		db.importJobs,
		db.aliases,
		db.reviewItems
	];
	const result = await db.transaction('rw', tables, async () => {
		const { drink, created } = await resolveDrink(db, entry.drink);
		let venueId: number | null = null;
		if (entry.venue && 'place' in entry.venue) {
			venueId = (await venueForPlace(db, entry.venue.place)).id;
		} else if (entry.venue) {
			if (!(await db.venues.get(entry.venue.venueId))) throw new Error('Unknown venue');
			venueId = entry.venue.venueId;
		}
		const jobId = await manualJobId(db);
		const consumptionId = await db.consumptions.add({
			rowKey: `manual:${crypto.randomUUID()}`,
			drinkId: drink.id,
			venueId,
			date,
			ts,
			rating,
			servingType: cleanString(entry.servingType ?? null, 40),
			importJobId: jobId
		});
		await db.importJobs
			.where('id')
			.equals(jobId)
			.modify((j) => {
				j.added++;
			});
		return { consumptionId, drinkId: drink.id, venueId, newDrink: created };
	});
	if (entry.venue && 'place' in entry.venue && isCustom(entry.venue.place.ref))
		await setCustomVisited(db, entry.venue.place.ref, true);
	return result;
}

/**
 * Marks a map place visited without logging a drink. An OpenStreetMap venue gets a history venue
 * (so it matches as visited from now on); a place you added has its "been here" flag set.
 */
export async function markVisited(db: PintMartenDB, place: MapPlace): Promise<void> {
	if (isCustom(place.ref)) {
		await setCustomVisited(db, place.ref, true);
		return;
	}
	await db.transaction('rw', db.venues, () => venueForPlace(db, place));
}

export async function drinkOptions(db: PintMartenDB): Promise<DrinkOption[]> {
	const [drinks, producers] = await Promise.all([db.drinks.toArray(), db.producers.toArray()]);
	const producerName = new Map(producers.map((p) => [p.id, p.name]));
	return drinks.map((d) => {
		const producer = producerName.get(d.producerId) ?? '';
		return {
			id: d.id,
			name: d.name,
			producer,
			style: d.style,
			category: d.category,
			search: normalizeText(`${d.name} ${producer}`)
		};
	});
}

export async function venueOptions(db: PintMartenDB): Promise<VenueOption[]> {
	return (await db.venues.toArray()).map((v) => ({
		id: v.id,
		name: v.name,
		city: v.city,
		search: normalizeText(`${v.name} ${v.city ?? ''}`)
	}));
}

/**
 * Options whose name (or producer, or city) contains every typed word. Options whose text starts
 * with the query come first, then shorter names.
 */
export function filterOptions<T extends { name: string; search: string }>(
	options: readonly T[],
	query: string,
	limit = 8
): T[] {
	const q = normalizeText(query);
	if (!q) return [];
	const words = q.split(' ');
	return options
		.filter((o) => words.every((w) => o.search.includes(w)))
		.map((o) => ({ o, starts: o.search.startsWith(q) ? 0 : 1 }))
		.sort((a, b) => a.starts - b.starts || a.o.name.length - b.o.name.length)
		.slice(0, limit)
		.map((x) => x.o);
}

/** The history drink with this name and producer (ignoring case, punctuation and suffixes). */
export function matchDrink(
	options: readonly DrinkOption[],
	name: string,
	producer: string
): DrinkOption | null {
	const dk = drinkKey(name);
	const pk = producerKey(producer);
	return options.find((o) => drinkKey(o.name) === dk && producerKey(o.producer) === pk) ?? null;
}

/** The history venue whose name matches, by the same rule as map "visited" matching. */
export function matchVenue(options: readonly VenueOption[], name: string): VenueOption | null {
	const key = venueMatchKey(name);
	return (
		options.find((o) => venueMatchKey(o.name) === key) ??
		options.find((o) => namesMatch(venueMatchKey(o.name), key)) ??
		null
	);
}
