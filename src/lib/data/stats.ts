import type { Category } from '../import/types';
import type { PintMartenDB } from './db';

export interface Stats {
	consumptions: number;
	drinks: number;
	producers: number;
	venues: number;
	byCategory: Record<Category, number>;
	naDrinks: number;
	openReviews: number;
	firstDate: string | null;
	lastDate: string | null;
}

export async function getStats(db: PintMartenDB): Promise<Stats> {
	const drinks = await db.drinks.toArray();
	const byCategory: Record<Category, number> = { beer: 0, cider: 0, mead: 0, other: 0 };
	for (const d of drinks) byCategory[d.category]++;
	const first = await db.consumptions.orderBy('ts').first();
	const last = await db.consumptions.orderBy('ts').last();
	return {
		consumptions: await db.consumptions.count(),
		drinks: drinks.length,
		producers: await db.producers.count(),
		venues: await db.venues.count(),
		byCategory,
		naDrinks: drinks.filter((d) => d.isNA).length,
		openReviews: await db.reviewItems.where('status').equals('open').count(),
		firstDate: first?.date ?? null,
		lastDate: last?.date ?? null
	};
}

/** Removes every record. The database itself stays so the app keeps working. */
export async function deleteAllData(db: PintMartenDB): Promise<void> {
	await db.transaction('rw', db.tables, async () => {
		await Promise.all(db.tables.map((t) => t.clear()));
	});
}
