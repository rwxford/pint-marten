import { cleanString } from './normalize';

/** What a beer app's share text says about a check-in. */
export interface SharedCheckin {
	drink: string;
	producer: string;
	venue: string | null;
	/** The check-in link, kept as text only. It is never fetched. */
	url: string | null;
}

const URL = /\bhttps?:\/\/\S+/gi;
/**
 * "Drinking a <drink> by <producer>", then optionally " at <venue>" or " @ <venue>". The drink
 * name is greedy so a name containing " by " ("Stand By Me by …") splits at the last one; the
 * producer is lazy so a venue name containing " at " ("Bar at the Park") stays whole.
 */
const CHECKIN =
	/\bdrinking an? (?<drink>.+) by (?<producer>.+?)(?:\s+(?:@|at)\s+(?<venue>.+?))?\s*$/i;

/**
 * Reads the text the Untappd app's share sheet copies for a check-in, roughly
 * "Drinking a High & Hazy by Terrapin Beer Co. at Blue Moon Brew House — https://…".
 * Returns null when the text doesn't look like one, so the form can be filled by hand instead.
 * The exact wording can change, so this is deliberately forgiving.
 */
export function parseShareText(text: string): SharedCheckin | null {
	const input = text.slice(0, 2000);
	const url = input.match(URL)?.[0]?.replace(/[)\].,]+$/, '') ?? null;
	const line = input
		.replace(URL, ' ')
		.replace(/(^|\s)#\w+/g, ' ')
		.replace(/\s+/g, ' ')
		// Separators left behind where the link or hashtags were.
		.replace(/[\s—–|-]+$/, '')
		.trim();
	const m = CHECKIN.exec(line);
	if (!m?.groups) return null;
	// A trailing period is kept on names in the middle ("Terrapin Beer Co. at …") and dropped
	// from the last one, where it more likely ends the sentence.
	const strip = (s: string | undefined, last: boolean) =>
		cleanString(
			s?.replace(/^[\s"“”']+/, '').replace(last ? /[\s"“”'.!,]+$/ : /[\s"“”'!,]+$/, '') ?? null
		);
	const venue = strip(m.groups.venue, true);
	const drink = strip(m.groups.drink, false);
	const producer = strip(m.groups.producer, !venue);
	if (!drink || !producer) return null;
	return { drink, producer, venue, url };
}
