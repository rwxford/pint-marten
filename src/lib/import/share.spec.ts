import { describe, expect, it } from 'vitest';
import { parseShareText } from './share';

describe('parseShareText', () => {
	it('reads drink, producer, venue and link', () => {
		expect(
			parseShareText(
				'Drinking a High & Hazy by Terrapin Beer Co. at Blue Moon Brew House — https://untp.beer/s/c1234567'
			)
		).toEqual({
			drink: 'High & Hazy',
			producer: 'Terrapin Beer Co.',
			venue: 'Blue Moon Brew House',
			url: 'https://untp.beer/s/c1234567'
		});
	});

	it('accepts "an", "@", hashtags and surrounding text', () => {
		expect(
			parseShareText(
				'I just checked in! Drinking an Orchard Dry by Orchard Hollow Cider @ The Corner Pub #photo #untappd\nhttp://untp.beer/s/c99'
			)
		).toEqual({
			drink: 'Orchard Dry',
			producer: 'Orchard Hollow Cider',
			venue: 'The Corner Pub',
			url: 'http://untp.beer/s/c99'
		});
	});

	it('works without a venue or a link', () => {
		expect(parseShareText('Drinking a Marten Haze by Fictional Fox Brewing Company.')).toEqual({
			drink: 'Marten Haze',
			producer: 'Fictional Fox Brewing Company',
			venue: null,
			url: null
		});
	});

	it('splits names that contain "by" or "at"', () => {
		expect(
			parseShareText('Drinking a Stand By Me by Some Brewery at Bar at the Park')
		).toMatchObject({ drink: 'Stand By Me', producer: 'Some Brewery', venue: 'Bar at the Park' });
	});

	it('returns null for anything else', () => {
		expect(parseShareText('')).toBeNull();
		expect(parseShareText('I just earned the Hopped Up badge! https://untp.beer/s/b1')).toBeNull();
		expect(parseShareText('Drinking a  by  at nowhere')).toBeNull();
	});
});
