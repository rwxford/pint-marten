import { categorize, isNonAlcoholic } from '../import/category';
import type { Drink } from './db';

/**
 * Fills a drink's missing style and ABV from another source, and recomputes what's derived from
 * them. A newly known style can change the category (a "beer" with no style may turn out to be a
 * cider), and a newly known ABV or style can change whether it's non-alcoholic.
 *
 * Returns only the fields that change.
 */
export function enrichDrink(
	target: Drink,
	incoming: { style: string | null; abv: number | null; sourceKey?: string | null }
): Partial<Drink> {
	const patch: Partial<Drink> = {};
	if (incoming.sourceKey && !target.sourceKey) patch.sourceKey = incoming.sourceKey;
	const styleFilled = target.style === null && !!incoming.style;
	const abvFilled = target.abv === null && incoming.abv !== null;
	if (styleFilled) patch.style = incoming.style;
	if (abvFilled) patch.abv = incoming.abv;

	if (styleFilled || abvFilled) {
		const style = patch.style ?? target.style;
		const abv = patch.abv ?? target.abv;
		if (styleFilled) {
			const category = categorize(style, target.name);
			if (category !== target.category) patch.category = category;
		}
		const isNA = isNonAlcoholic(abv, style, target.name);
		if (isNA !== target.isNA) patch.isNA = isNA;
	}
	return patch;
}
