import type { Drink, PintMartenDB, Producer, ReviewItem } from './db';

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
		[db.producers, db.drinks, db.consumptions, db.reviewItems],
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
	const patch: Partial<Drink> = {};
	if (!into.sourceKey && from.sourceKey) patch.sourceKey = from.sourceKey;
	if (into.style === null && from.style) patch.style = from.style;
	if (into.abv === null && from.abv !== null) patch.abv = from.abv;
	if (Object.keys(patch).length) await db.drinks.update(intoId, patch);
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
	await db.producers.delete(fromId);
	await retarget(db, 'producer', fromId, intoId);
}

/** Other open review items that pointed at a merged-away record now point at its survivor. */
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
}
