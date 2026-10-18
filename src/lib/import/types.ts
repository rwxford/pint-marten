export const CATEGORIES = ['beer', 'cider', 'mead', 'seltzer', 'kombucha', 'other'] as const;

export type Category = (typeof CATEGORIES)[number];

export type ImportSource = 'untappd' | 'generic';

/** One consumption (check-in) from any source, normalized but not yet matched against the DB. */
export interface ImportRecord {
	/** Stable per source row, used to make re-imports idempotent. */
	sourceRowId: string;
	drink: {
		name: string;
		style: string | null;
		/** Percent alcohol by volume; null when unknown. */
		abv: number | null;
		category: Category;
		isNA: boolean;
		/** The source app's own ID for this drink, when it has one. */
		sourceId: string | null;
	};
	producer: {
		name: string;
		city: string | null;
		region: string | null;
		country: string | null;
		sourceId: string | null;
	};
	venue: {
		name: string;
		city: string | null;
		region: string | null;
		country: string | null;
		lat: number | null;
		lng: number | null;
		sourceId: string | null;
	} | null;
	/** ISO 8601, keeping the original UTC offset when the source has one. */
	date: string | null;
	/** 0–5. */
	rating: number | null;
	servingType: string | null;
}

export interface RowError {
	/** 1-based row number in the source file (header row excluded). */
	row: number;
	message: string;
}

export interface ParsedImport {
	source: ImportSource;
	records: ImportRecord[];
	errors: RowError[];
}
