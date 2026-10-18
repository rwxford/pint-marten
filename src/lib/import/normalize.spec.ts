import { describe, expect, it } from 'vitest';
import { cleanString, drinkKey, normalizeText, producerKey, similarity } from './normalize';

describe('normalizeText', () => {
	it('lowercases, strips accents and punctuation', () => {
		expect(normalizeText('  Øl Nummer Én!! ')).toBe('øl nummer en');
		expect(normalizeText("Dogfish Head's 60-Minute")).toBe('dogfish heads 60 minute');
	});

	it('spells out ampersands', () => {
		expect(normalizeText('Hops & Barley')).toBe('hops and barley');
	});
});

describe('producerKey', () => {
	it.each([
		['Fictional Fox Brewing Company', 'fictional fox'],
		['Fictional Fox Brewing Co.', 'fictional fox'],
		['Fictional Fox Brewing', 'fictional fox'],
		['The Fictional Fox Brewery', 'fictional fox'],
		['Pretend Cidery', 'pretend'],
		['Make-Believe Meadery', 'make believe'],
		['Imaginary Beer Co., LLC', 'imaginary']
	])('%s → %s', (name, key) => {
		expect(producerKey(name)).toBe(key);
	});

	it('keeps names made only of suffixes', () => {
		expect(producerKey('The Brewery')).toBe('brewery');
	});
});

describe('drinkKey', () => {
	it('does not strip words from drink names', () => {
		expect(drinkKey('Brewery Reserve Co. Ale')).toBe('brewery reserve co ale');
	});
});

describe('similarity', () => {
	it('is 1 for identical strings and high for near-matches', () => {
		expect(similarity('marten haze', 'marten haze')).toBe(1);
		expect(similarity('marten haze', 'marten hazey')).toBeGreaterThan(0.9);
		expect(similarity('marten haze', 'riverbend red')).toBeLessThan(0.3);
	});

	it('handles short strings', () => {
		expect(similarity('a', 'b')).toBe(0);
	});
});

describe('cleanString', () => {
	it('trims, collapses whitespace and caps length', () => {
		expect(cleanString('  a \n b  ')).toBe('a b');
		expect(cleanString('x'.repeat(500))).toHaveLength(300);
		expect(cleanString('   ')).toBeNull();
		expect(cleanString(null)).toBeNull();
		expect(cleanString(42)).toBe('42');
	});
});
