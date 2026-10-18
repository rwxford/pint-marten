import Dexie, { type EntityTable } from 'dexie';
import type { Category, ImportSource } from '../import/types';

export interface Producer {
	id: number;
	name: string;
	/** Normalized name used for matching across sources. */
	key: string;
	/** Source app ID, e.g. "untappd:618". */
	sourceKey: string | null;
	city: string | null;
	region: string | null;
	country: string | null;
}

export interface Drink {
	id: number;
	producerId: number;
	name: string;
	key: string;
	sourceKey: string | null;
	style: string | null;
	abv: number | null;
	category: Category;
	isNA: boolean;
}

export interface Venue {
	id: number;
	name: string;
	/** Normalized "name|city", used to match venues that have no source ID. */
	nameKey: string;
	sourceKey: string | null;
	city: string | null;
	region: string | null;
	country: string | null;
	lat: number | null;
	lng: number | null;
}

export interface Consumption {
	id: number;
	/** "<source>:<source row ID>"; unique, so re-importing a file adds nothing twice. */
	rowKey: string;
	drinkId: number;
	venueId: number | null;
	date: string | null;
	/** Epoch milliseconds for sorting; null when the date is unknown. */
	ts: number | null;
	rating: number | null;
	servingType: string | null;
	importJobId: number;
}

export interface ImportJob {
	id: number;
	source: ImportSource;
	fileName: string;
	importedAt: string;
	added: number;
	duplicates: number;
	errors: number;
}

export interface ReviewItem {
	id: number;
	kind: 'drink' | 'producer';
	/** The record created by the import that may be a duplicate. */
	newId: number;
	/** The existing record it closely resembles. */
	candidateId: number;
	score: number;
	status: 'open' | 'merged' | 'separate';
	createdAt: string;
}

/**
 * A name or source ID that was merged into another record. Lookups consult aliases after direct
 * matches, so a merged-away name isn't recreated (and re-reviewed) by the next import.
 */
export interface Alias {
	/** e.g. "drink:name:<producerId>|<key>", "drink:source:untappd:501", "producer:name:<key>". */
	key: string;
	kind: 'drink' | 'producer';
	targetId: number;
}

export type PintMartenDB = Dexie & {
	producers: EntityTable<Producer, 'id'>;
	drinks: EntityTable<Drink, 'id'>;
	venues: EntityTable<Venue, 'id'>;
	consumptions: EntityTable<Consumption, 'id'>;
	importJobs: EntityTable<ImportJob, 'id'>;
	reviewItems: EntityTable<ReviewItem, 'id'>;
	aliases: EntityTable<Alias, 'key'>;
};

export function openDatabase(name = 'pint-marten'): PintMartenDB {
	const db = new Dexie(name) as PintMartenDB;
	db.version(1).stores({
		producers: '++id, key, sourceKey',
		drinks: '++id, producerId, [producerId+key], sourceKey, category',
		venues: '++id, nameKey, sourceKey',
		consumptions: '++id, &rowKey, drinkId, venueId, ts',
		importJobs: '++id, importedAt',
		reviewItems: '++id, status, [kind+newId], [kind+candidateId]'
	});
	db.version(2).stores({ aliases: '&key, [kind+targetId]' });
	return db;
}

let instance: PintMartenDB | undefined;

/** The app's database. Browser-only: call from onMount or event handlers, never during SSR. */
export function getDb(): PintMartenDB {
	instance ??= openDatabase();
	return instance;
}
