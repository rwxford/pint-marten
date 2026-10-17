import { drinkKey, normalizeText, producerKey, similarity } from '../import/normalize';
import type { ImportRecord, ParsedImport } from '../import/types';
import { dateToTimestamp } from '../import/values';
import type { Drink, PintMartenDB, Producer, Venue } from './db';

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
}

function sourceKey(source: string, id: string | null): string | null {
	return id ? `${source}:${id}` : null;
}

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
		db.reviewItems
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

		const result: ApplyResult = {
			jobId,
			added: 0,
			duplicates: 0,
			newDrinks: 0,
			newProducers: 0,
			newVenues: 0,
			reviewItems: 0
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
			const bySource = sk ? producerBySource.get(sk) : undefined;
			if (bySource) return bySource;

			const byKey = producerByKey.get(key);
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
			result.newProducers++;
			if (sk) producerBySource.set(sk, created);
			if (!producerByKey.has(key)) producerByKey.set(key, created);
			if (best) await queueReview('producer', created.id, best.p.id, best.score);
			return created;
		};

		const resolveDrink = async (rec: ImportRecord, producer: Producer): Promise<Drink> => {
			const sk = sourceKey(parsed.source, rec.drink.sourceId);
			const key = drinkKey(rec.drink.name);
			const existing =
				(sk ? drinkBySource.get(sk) : undefined) ?? drinkByKey.get(`${producer.id}|${key}`);
			if (existing && (!sk || !existing.sourceKey || existing.sourceKey === sk)) {
				const patch: Partial<Drink> = {};
				if (sk && !existing.sourceKey) patch.sourceKey = sk;
				if (existing.style === null && rec.drink.style) patch.style = rec.drink.style;
				if (existing.abv === null && rec.drink.abv !== null) patch.abv = rec.drink.abv;
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
			await db.consumptions.add({
				rowKey,
				drinkId: drink.id,
				venueId: venue?.id ?? null,
				date: rec.date,
				ts: dateToTimestamp(rec.date),
				rating: rec.rating,
				servingType: rec.servingType,
				importJobId: jobId
			});
			result.added++;
		}

		await db.importJobs.update(jobId, { added: result.added, duplicates: result.duplicates });
		return result;
	});
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}
