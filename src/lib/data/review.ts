import { aliasKey } from './apply';
import type { PintMartenDB, Producer, ReviewItem } from './db';
import { enrichDrink } from './enrich';

export interface ReviewEntry {
	item: ReviewItem;
	newName: string;
	candidateName: string;
	/** Producer name for drink reviews, to make the pair recognizable. */
	context: string | null;
	newCount: number;
	candidateCount: number;
}

export async function openReviews(db: PintMartenDB): Promise<ReviewEntry[]> {
	const items = await db.reviewItems.where('status').equals('open').toArray();
	const entries: ReviewEntry[] = [];
	for (const item of items) {
		if (item.kind === 'drink') {
			const [a, b] = await Promise.all([
				db.drinks.get(item.newId),
				db.drinks.get(item.candidateId)
			]);
			if (!a || !b) continue;
			const producer = await db.producers.get(b.producerId);
			entries.push({
				item,
				newName: a.name,
				candidateName: b.name,
				context: producer?.name ?? null,
				newCount: await db.consumptions.where('drinkId').equals(a.id).count(),
				candidateCount: await db.consumptions.where('drinkId').equals(b.id).count()
			});
		} else {
			const [a, b] = await Promise.all([
				db.producers.get(item.newId),
				db.producers.get(item.candidateId)
			]);
			if (!a || !b) continue;
			entries.push({
				item,
				newName: a.name,
				candidateName: b.name,
				context: null,
				newCount: await db.drinks.where('producerId').equals(a.id).count(),
				candidateCount: await db.drinks.where('producerId').equals(b.id).count()
			});
		}
	}
	return entries;
}

export async function keepSeparate(db: PintMartenDB, id: number): Promise<void> {
	await db.reviewItems.update(id, { status: 'separate' });
}

/** Merges the newly imported record into the existing candidate. */
export async function mergeReview(db: PintMartenDB, id: number): Promise<void> {
	await db.transaction(
		'rw',
		[db.producers, db.drinks, db.consumptions, db.reviewItems, db.aliases],
		async () => {
			const item = await db.reviewItems.get(id);
			if (!item || item.status !== 'open') return;
			if (item.kind === 'drink') await mergeDrinks(db, item.newId, item.candidateId);
			else await mergeProducers(db, item.newId, item.candidateId);
			await db.reviewItems.update(id, { status: 'merged' });
		}
	);
}

async function mergeDrinks(db: PintMartenDB, fromId: number, intoId: number) {
	const [from, into] = await Promise.all([db.drinks.get(fromId), db.drinks.get(intoId)]);
	if (!from || !into) return;
	await db.consumptions.where('drinkId').equals(fromId).modify({ drinkId: intoId });
	const patch = enrichDrink(into, from);
	if (Object.keys(patch).length) await db.drinks.update(intoId, patch);
	// Remember the merged-away name (and source ID, if the survivor didn't take it) so later
	// imports land on the survivor instead of recreating the duplicate.
	const aliases = [aliasKey.drinkName(into.producerId, from.key)];
	if (from.sourceKey && patch.sourceKey !== from.sourceKey) {
		aliases.push(aliasKey.drinkSource(from.sourceKey));
	}
	await db.aliases.bulkPut(
		aliases.map((key) => ({ key, kind: 'drink' as const, targetId: intoId }))
	);
	await db.drinks.delete(fromId);
	await retarget(db, 'drink', fromId, intoId);
}

async function mergeProducers(db: PintMartenDB, fromId: number, intoId: number) {
	const [from, into] = await Promise.all([db.producers.get(fromId), db.producers.get(intoId)]);
	if (!from || !into) return;
	const existing = new Map(
		(await db.drinks.where('producerId').equals(intoId).toArray()).map((d) => [d.key, d])
	);
	for (const drink of await db.drinks.where('producerId').equals(fromId).toArray()) {
		const twin = existing.get(drink.key);
		if (twin) await mergeDrinks(db, drink.id, twin.id);
		else await db.drinks.update(drink.id, { producerId: intoId });
	}
	const patch: Partial<Producer> = {};
	if (!into.sourceKey && from.sourceKey) patch.sourceKey = from.sourceKey;
	for (const f of ['city', 'region', 'country'] as const)
		if (!into[f] && from[f]) patch[f] = from[f];
	if (Object.keys(patch).length) await db.producers.update(intoId, patch);
	const aliases = [aliasKey.producerName(from.key)];
	if (from.sourceKey && patch.sourceKey !== from.sourceKey) {
		aliases.push(aliasKey.producerSource(from.sourceKey));
	}
	await db.aliases.bulkPut(
		aliases.map((key) => ({ key, kind: 'producer' as const, targetId: intoId }))
	);
	// Drink-name aliases are scoped to a producer; move the old producer's to the survivor.
	const prefix = aliasKey.drinkName(fromId, '');
	const scoped = await db.aliases.where('key').startsWith(prefix).toArray();
	await db.aliases.bulkDelete(scoped.map((a) => a.key));
	await db.aliases.bulkPut(
		scoped.map((a) => ({ ...a, key: aliasKey.drinkName(intoId, a.key.slice(prefix.length)) }))
	);
	await db.producers.delete(fromId);
	await retarget(db, 'producer', fromId, intoId);
}

/**
 * Review items and aliases that pointed at a merged-away record now point at its survivor, so
 * chains of merges keep resolving.
 */
async function retarget(
	db: PintMartenDB,
	kind: 'drink' | 'producer',
	fromId: number,
	intoId: number
) {
	await db.reviewItems
		.where('[kind+newId]')
		.equals([kind, fromId])
		.modify((r) => {
			r.newId = intoId;
			if (r.newId === r.candidateId) r.status = 'merged';
		});
	await db.reviewItems
		.where('[kind+candidateId]')
		.equals([kind, fromId])
		.modify((r) => {
			r.candidateId = intoId;
			if (r.newId === r.candidateId) r.status = 'merged';
		});
	await db.aliases.where('[kind+targetId]').equals([kind, fromId]).modify({ targetId: intoId });
}
