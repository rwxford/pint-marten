import { drinkKey, normalizeText, producerKey, similarity } from '../import/normalize';
import type { ImportRecord, ParsedImport } from '../import/types';
import { dateToTimestamp } from '../import/values';
import { distanceMeters, MATCH_RADIUS_M, namesMatch, venueMatchKey } from '../venues/match';
import type { Consumption, Drink, PintMartenDB, Producer, Venue } from './db';
import { enrichDrink } from './enrich';

/** A drink logged in the app and an imported check-in this close in time are the same drink. */
export const MANUAL_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Names at least this similar (but not identical) are queued for the user to review. */
export const PRODUCER_REVIEW_THRESHOLD = 0.88;
export const DRINK_REVIEW_THRESHOLD = 0.85;

export interface ApplyResult {
	jobId: number;
	added: number;
	duplicates: number;
	newDrinks: number;
	newProducers: number;
	newVenues: number;
	reviewItems: number;
	/** Drinks logged in the app that this import contained, replaced by the imported rows. */
	replacedManual: number;
}

function sourceKey(source: string, id: string | null): string | null {
	return id ? `${source}:${id}` : null;
}

export const aliasKey = {
	drinkName: (producerId: number, key: string) => `drink:name:${producerId}|${key}`,
	drinkSource: (sk: string) => `drink:source:${sk}`,
	producerName: (key: string) => `producer:name:${key}`,
	producerSource: (sk: string) => `producer:source:${sk}`
};

function venueNameKey(name: string, city: string | null): string {
	return `${normalizeText(name)}|${normalizeText(city ?? '')}`;
}

/**
 * Two records that both carry an ID from the same source app are distinct by definition, so only
 * pairs where at least one side lacks a source ID are worth asking the user about.
 */
function reviewable(a: string | null, b: string | null): boolean {
	return a === null || b === null;
}

/**
 * Writes parsed records to the database in one transaction.
 *
 * Matching order for each entity: source app ID, then exact normalized name. When neither
 * matches, a new record is created; if it closely resembles an existing one, a review item is
 * queued instead of merging silently. Rows already imported (same row key) are skipped.
 */
export async function applyImport(
	db: PintMartenDB,
	parsed: ParsedImport,
	fileName: string
): Promise<ApplyResult> {
	const tables = [
		db.producers,
		db.drinks,
		db.venues,
		db.consumptions,
		db.importJobs,
		db.reviewItems,
		db.aliases
	];
	return db.transaction('rw', tables, async () => {
		const now = new Date().toISOString();
		const jobId = await db.importJobs.add({
			source: parsed.source,
			fileName: fileName.slice(0, 200),
			importedAt: now,
			added: 0,
			duplicates: 0,
			errors: parsed.errors.length
		});

		const producers = await db.producers.toArray();
		const drinks = await db.drinks.toArray();
		const venues = await db.venues.toArray();
		const seenRows = new Set((await db.consumptions.orderBy('rowKey').keys()) as string[]);
		const aliases = new Map((await db.aliases.toArray()).map((a) => [a.key, a.targetId]));
		const producerById = new Map(producers.map((p) => [p.id, p]));
		const drinkById = new Map(drinks.map((d) => [d.id, d]));
		const aliasedProducer = (key: string) => producerById.get(aliases.get(key) ?? -1);
		const aliasedDrink = (key: string) => drinkById.get(aliases.get(key) ?? -1);

		const producerBySource = new Map(
			producers.filter((p) => p.sourceKey).map((p) => [p.sourceKey!, p])
		);
		const producerByKey = new Map<string, Producer>();
		for (const p of producers) if (!producerByKey.has(p.key)) producerByKey.set(p.key, p);
		const drinkBySource = new Map(drinks.filter((d) => d.sourceKey).map((d) => [d.sourceKey!, d]));
		const drinkByKey = new Map(drinks.map((d) => [`${d.producerId}|${d.key}`, d]));
		const drinksByProducer = new Map<number, Drink[]>();
		for (const d of drinks) pushTo(drinksByProducer, d.producerId, d);
		const venueBySource = new Map(venues.filter((v) => v.sourceKey).map((v) => [v.sourceKey!, v]));
		const venueByKey = new Map(venues.map((v) => [v.nameKey, v]));
		const venueById = new Map(venues.map((v) => [v.id, v]));
		// Drinks logged in the app, by drink, so an imported check-in can replace its hand-logged twin.
		const manualByDrink = new Map<number, Consumption[]>();
		for (const c of await db.consumptions.where('rowKey').startsWith('manual:').toArray())
			pushTo(manualByDrink, c.drinkId, c);
		const manualJobs = new Map<number, number>();

		const result: ApplyResult = {
			jobId,
			added: 0,
			duplicates: 0,
			newDrinks: 0,
			newProducers: 0,
			newVenues: 0,
			reviewItems: 0,
			replacedManual: 0
		};

		const queueReview = async (
			kind: 'drink' | 'producer',
			newId: number,
			candidateId: number,
			score: number
		) => {
			await db.reviewItems.add({
				kind,
				newId,
				candidateId,
				score: Math.round(score * 100) / 100,
				status: 'open',
				createdAt: now
			});
			result.reviewItems++;
		};

		const resolveProducer = async (rec: ImportRecord): Promise<Producer> => {
			const sk = sourceKey(parsed.source, rec.producer.sourceId);
			const key = producerKey(rec.producer.name);
			const bySource = sk
				? (producerBySource.get(sk) ?? aliasedProducer(aliasKey.producerSource(sk)))
				: undefined;
			if (bySource) return bySource;

			const byKey = producerByKey.get(key) ?? aliasedProducer(aliasKey.producerName(key));
			if (byKey && (!sk || !byKey.sourceKey || byKey.sourceKey === sk)) {
				if (sk && !byKey.sourceKey) {
					byKey.sourceKey = sk;
					await db.producers.update(byKey.id, { sourceKey: sk });
					producerBySource.set(sk, byKey);
				}
				return byKey;
			}

			let best: { p: Producer; score: number } | null = null;
			for (const p of producerByKey.values()) {
				if (!reviewable(sk, p.sourceKey)) continue;
				const score = similarity(key, p.key);
				if (score >= PRODUCER_REVIEW_THRESHOLD && (!best || score > best.score))
					best = { p, score };
			}

			const fields: Omit<Producer, 'id'> = {
				name: rec.producer.name,
				key,
				sourceKey: sk,
				city: rec.producer.city,
				region: rec.producer.region,
				country: rec.producer.country
			};
			const created: Producer = { id: await db.producers.add(fields), ...fields };
			producerById.set(created.id, created);
			result.newProducers++;
			if (sk) producerBySource.set(sk, created);
			if (!producerByKey.has(key)) producerByKey.set(key, created);
			if (best) await queueReview('producer', created.id, best.p.id, best.score);
			return created;
		};

		const resolveDrink = async (rec: ImportRecord, producer: Producer): Promise<Drink> => {
			const sk = sourceKey(parsed.source, rec.drink.sourceId);
			const key = drinkKey(rec.drink.name);
			// A source-ID match (direct or via alias) is authoritative. A name match only counts
			// when it can't contradict the source ID.
			const bySource = sk
				? (drinkBySource.get(sk) ?? aliasedDrink(aliasKey.drinkSource(sk)))
				: undefined;
			const byName =
				drinkByKey.get(`${producer.id}|${key}`) ??
				aliasedDrink(aliasKey.drinkName(producer.id, key));
			const existing =
				bySource ??
				(byName && (!sk || !byName.sourceKey || byName.sourceKey === sk) ? byName : undefined);
			if (existing) {
				const patch = enrichDrink(existing, { ...rec.drink, sourceKey: sk });
				if (Object.keys(patch).length) {
					Object.assign(existing, patch);
					await db.drinks.update(existing.id, patch);
					if (patch.sourceKey) drinkBySource.set(patch.sourceKey, existing);
				}
				return existing;
			}

			let best: { d: Drink; score: number } | null = null;
			for (const d of drinksByProducer.get(producer.id) ?? []) {
				if (!reviewable(sk, d.sourceKey)) continue;
				const score = similarity(key, d.key);
				if (score >= DRINK_REVIEW_THRESHOLD && (!best || score > best.score)) best = { d, score };
			}

			const fields: Omit<Drink, 'id'> = {
				producerId: producer.id,
				name: rec.drink.name,
				key,
				sourceKey: sk,
				style: rec.drink.style,
				abv: rec.drink.abv,
				category: rec.drink.category,
				isNA: rec.drink.isNA
			};
			const created: Drink = { id: await db.drinks.add(fields), ...fields };
			drinkById.set(created.id, created);
			result.newDrinks++;
			if (sk) drinkBySource.set(sk, created);
			if (!drinkByKey.has(`${producer.id}|${key}`))
				drinkByKey.set(`${producer.id}|${key}`, created);
			pushTo(drinksByProducer, producer.id, created);
			if (best) await queueReview('drink', created.id, best.d.id, best.score);
			return created;
		};

		const resolveVenue = async (rec: ImportRecord): Promise<Venue | null> => {
			const v = rec.venue;
			if (!v) return null;
			const sk = sourceKey(parsed.source, v.sourceId);
			const nameKey = venueNameKey(v.name, v.city);
			const existing = (sk ? venueBySource.get(sk) : undefined) ?? venueByKey.get(nameKey);
			if (existing && (!sk || !existing.sourceKey || existing.sourceKey === sk)) {
				const patch: Partial<Venue> = {};
				if (sk && !existing.sourceKey) patch.sourceKey = sk;
				if (existing.lat === null && v.lat !== null)
					Object.assign(patch, { lat: v.lat, lng: v.lng });
				if (Object.keys(patch).length) {
					Object.assign(existing, patch);
					await db.venues.update(existing.id, patch);
					if (patch.sourceKey) venueBySource.set(patch.sourceKey, existing);
				}
				return existing;
			}
			const fields: Omit<Venue, 'id'> = { ...v, nameKey, sourceKey: sk };
			const created: Venue = { id: await db.venues.add(fields), ...fields };
			venueById.set(created.id, created);
			result.newVenues++;
			if (sk) venueBySource.set(sk, created);
			if (!venueByKey.has(nameKey)) venueByKey.set(nameKey, created);
			return created;
		};

		for (const rec of parsed.records) {
			const rowKey = `${parsed.source}:${rec.sourceRowId}`;
			if (seenRows.has(rowKey)) {
				result.duplicates++;
				continue;
			}
			seenRows.add(rowKey);

			const producer = await resolveProducer(rec);
			const drink = await resolveDrink(rec, producer);
			const venue = await resolveVenue(rec);
			const ts = dateToTimestamp(rec.date);
			const twin = takeManualTwin(manualByDrink, drink.id, ts, venue, venueById);
			if (twin) {
				await db.consumptions.delete(twin.id);
				manualJobs.set(twin.importJobId, (manualJobs.get(twin.importJobId) ?? 0) + 1);
				result.replacedManual++;
			}
			await db.consumptions.add({
				rowKey,
				drinkId: drink.id,
				venueId: venue?.id ?? null,
				date: rec.date,
				ts,
				rating: rec.rating,
				servingType: rec.servingType,
				importJobId: jobId
			});
			result.added++;
		}

		await db.importJobs.update(jobId, { added: result.added, duplicates: result.duplicates });
		for (const [id, removed] of manualJobs)
			await db.importJobs
				.where('id')
				.equals(id)
				.modify((j) => {
					j.added = Math.max(0, j.added - removed);
				});
		return result;
	});
}

/** Same place: the same history venue, or venues within 150 m whose names match. */
function sameVenue(a: Venue, b: Venue): boolean {
	if (a.id === b.id) return true;
	if (a.lat === null || a.lng === null || b.lat === null || b.lng === null)
		return a.nameKey === b.nameKey;
	return (
		distanceMeters(a.lat, a.lng, b.lat, b.lng) <= MATCH_RADIUS_M &&
		namesMatch(venueMatchKey(a.name), venueMatchKey(b.name))
	);
}

/**
 * Finds and removes from `manualByDrink` the hand-logged consumption an imported check-in
 * duplicates: same drink, within two hours, and the same venue (unless either side has none).
 * The closest in time wins.
 */
function takeManualTwin(
	manualByDrink: Map<number, Consumption[]>,
	drinkId: number,
	ts: number | null,
	venue: Venue | null,
	venueById: Map<number, Venue>
): Consumption | null {
	const list = manualByDrink.get(drinkId);
	if (!list || ts === null) return null;
	let best = -1;
	let bestGap = Infinity;
	for (const [i, c] of list.entries()) {
		if (c.ts === null) continue;
		const gap = Math.abs(c.ts - ts);
		if (gap > MANUAL_MATCH_WINDOW_MS || gap >= bestGap) continue;
		const mv = c.venueId === null ? undefined : venueById.get(c.venueId);
		if (venue && mv && !sameVenue(venue, mv)) continue;
		best = i;
		bestGap = gap;
	}
	return best < 0 ? null : list.splice(best, 1)[0];
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}
