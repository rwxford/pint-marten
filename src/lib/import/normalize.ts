/** Longest suffixes first so "brewing company" is stripped before "company". */
const PRODUCER_SUFFIXES = [
	'craft brewing company',
	'brewing company',
	'brewing co',
	'brewery and taproom',
	'brewery taproom',
	'beer company',
	'beer co',
	'cider company',
	'cider co',
	'mead company',
	'meadery',
	'cidery',
	'brewery',
	'brewing',
	'brewers',
	'brewhouse',
	'company',
	'co',
	'llc',
	'ltd',
	'inc'
];

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’`]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** Matching key for a producer: normalized, without "the" or corporate suffixes. */
export function producerKey(name: string): string {
	const base = normalizeText(name).replace(/^the /, '');
	let key = base;
	let changed = true;
	while (changed) {
		changed = false;
		for (const suffix of PRODUCER_SUFFIXES) {
			if (key.endsWith(` ${suffix}`)) {
				key = key.slice(0, -suffix.length - 1);
				changed = true;
				break;
			}
		}
	}
	// A name made only of suffixes ("The Brewery") keeps its full form.
	return key || base;
}

export function drinkKey(name: string): string {
	return normalizeText(name);
}

/** Sørensen–Dice similarity on character bigrams: 1 for identical strings, 0 for no overlap. */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const counts = new Map<string, number>();
	for (let i = 0; i < a.length - 1; i++) {
		const gram = a.slice(i, i + 2);
		counts.set(gram, (counts.get(gram) ?? 0) + 1);
	}
	let overlap = 0;
	for (let i = 0; i < b.length - 1; i++) {
		const gram = b.slice(i, i + 2);
		const n = counts.get(gram) ?? 0;
		if (n > 0) {
			counts.set(gram, n - 1);
			overlap++;
		}
	}
	return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** Trims, collapses inner whitespace and caps length so hostile files can't bloat storage. */
export function cleanString(value: unknown, maxLength = 300): string | null {
	if (value === null || value === undefined) return null;
	const s = String(value).replace(/\s+/g, ' ').trim();
	return s ? s.slice(0, maxLength) : null;
}
