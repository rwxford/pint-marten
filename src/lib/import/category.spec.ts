import { describe, expect, it } from 'vitest';
import { categorize, isNonAlcoholic } from './category';

describe('categorize', () => {
	it.each([
		['IPA - New England / Hazy', 'beer'],
		['Barleywine - English', 'beer'],
		['Wheat Beer - Wheat Wine', 'beer'],
		['Shandy / Radler', 'beer'],
		['Cider - Dry', 'cider'],
		['Cider - Perry / Poiré', 'cider'],
		['Cider - Graff', 'cider'],
		['Mead - Melomel', 'mead'],
		['Mead - Session / Short', 'mead'],
		['Mead - Pyment', 'mead'],
		['Hard Seltzer', 'other'],
		['Hard Kombucha / Jun', 'other'],
		['Sake - Ginjo', 'other'],
		['RTD - Vodka Seltzer', 'other'],
		['Hard Ginger Beer', 'other'],
		['Non-Alcoholic - Sparkling Water', 'other'],
		['Non-Alcoholic - Soda - Craft', 'other']
	] as const)('%s → %s', (style, category) => {
		expect(categorize(style)).toBe(category);
	});

	it('falls back to the name when there is no style', () => {
		expect(categorize(null, 'Orchard Hard Cider')).toBe('cider');
		expect(categorize(null, 'Wildflower Mead')).toBe('mead');
		expect(categorize(null, 'Some Lager')).toBe('beer');
	});
});

describe('isNonAlcoholic', () => {
	it('uses ABV when known', () => {
		expect(isNonAlcoholic(0.4, 'Stout - Oatmeal')).toBe(true);
		expect(isNonAlcoholic(0.5, null)).toBe(true);
		expect(isNonAlcoholic(0.6, 'Non-Alcoholic Beer')).toBe(false);
		expect(isNonAlcoholic(5, null)).toBe(false);
	});

	it('falls back to wording when ABV is unknown', () => {
		expect(isNonAlcoholic(null, 'Non-Alcoholic - Soda')).toBe(true);
		expect(isNonAlcoholic(null, 'IPA', 'Hazy Alcohol-Free IPA')).toBe(true);
		expect(isNonAlcoholic(null, 'IPA', 'Hazy 0.0')).toBe(true);
		expect(isNonAlcoholic(null, 'Lager - Pale', 'Helles 10.0')).toBe(false);
		expect(isNonAlcoholic(null, 'Lager - Pale')).toBe(false);
	});
});
