import type { Category } from './types';

/** US legal ceiling for "non-alcoholic": less than 0.5% ABV. */
export const NA_MAX_ABV = 0.5;

const SELTZER_STYLE = /seltzer/i;
const KOMBUCHA_STYLE = /kombucha|\bjun\b/i;
const OTHER_STYLE =
	/\bsake\b|\brtd\b|hard ginger beer|hard (iced )?tea|hard lemonade|hard cola|hard coffee|spirit|cocktail|\bsoda\b|sparkling water|energy drink|functional beverage|\bwine\b/i;
const BEER_WINE = /barley ?wine|wheat ?wine/i;
const CIDER_STYLE = /\bcider\b|\bperry\b|poir[ée]|apfelwein|\bgraff\b/i;
const MEAD_STYLE = /\bmead\b|melomel|metheglin|cyser|pyment|braggot|hydromel|acerglyn/i;
/**
 * Wording that marks a drink as non-alcoholic, including common non-English labels
 * ("0,0%", "senza alcol", "sin alcohol", "sans alcool", "alkoholfrei").
 */
const NA_TEXT =
	/non[- ]?alcoholic|alcohol[- ]free|\bn\/?a beer\b|(?<![\d.,])0[.,]0(?!\d)|senza alcol|sin alcohol|sans alcool|alkoholfrei|alcoholvrij/i;

/** Classifies a drink by its style (and name, as a fallback hint). */
export function categorize(style: string | null, name = ''): Category {
	const text = style ?? '';
	if (MEAD_STYLE.test(text)) return 'mead';
	if (CIDER_STYLE.test(text)) return 'cider';
	if (BEER_WINE.test(text)) return 'beer';
	if (SELTZER_STYLE.test(text)) return 'seltzer';
	if (KOMBUCHA_STYLE.test(text)) return 'kombucha';
	if (OTHER_STYLE.test(text)) return 'other';
	if (!text) {
		if (MEAD_STYLE.test(name)) return 'mead';
		if (CIDER_STYLE.test(name)) return 'cider';
	}
	return 'beer';
}

/**
 * Non-alcoholic when ABV is known and at most 0.5%, or when ABV is unknown and the style or name
 * says so. A known ABV always wins over wording.
 */
export function hasNaWording(style: string | null, name = ''): boolean {
	return NA_TEXT.test(style ?? '') || NA_TEXT.test(name);
}

export function isNonAlcoholic(abv: number | null, style: string | null, name = ''): boolean {
	if (abv !== null) return abv <= NA_MAX_ABV;
	return hasNaWording(style, name);
}
