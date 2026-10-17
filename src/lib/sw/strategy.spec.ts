import { describe, expect, it } from 'vitest';
import { cacheName, chooseStrategy, isStaleCache, precachePaths } from './strategy';

const origin = 'https://pintmarten.app';
const precached = new Set(['/', '/_app/immutable/entry/start.js', '/manifest.webmanifest']);

function req(path: string, init: { method?: string; mode?: RequestMode } = {}) {
	return {
		method: init.method ?? 'GET',
		mode: init.mode ?? 'cors',
		url: path.startsWith('http') ? path : origin + path
	};
}

describe('chooseStrategy', () => {
	it('serves precached files from the cache', () => {
		expect(chooseStrategy(req('/_app/immutable/entry/start.js'), origin, precached)).toBe(
			'precache'
		);
	});

	it('ignores query strings when matching precached paths', () => {
		expect(chooseStrategy(req('/manifest.webmanifest?v=2'), origin, precached)).toBe('precache');
	});

	it('treats page loads that are not precached as navigations', () => {
		expect(chooseStrategy(req('/venues/123', { mode: 'navigate' }), origin, precached)).toBe(
			'navigation'
		);
	});

	it('passes through non-GET requests', () => {
		expect(chooseStrategy(req('/', { method: 'POST' }), origin, precached)).toBe('passthrough');
	});

	it('never handles cross-origin requests', () => {
		const tile = req('https://tiles.openfreemap.org/planet/1/2/3.pbf');
		expect(chooseStrategy(tile, origin, precached)).toBe('passthrough');
		const lookalike = req('https://pintmarten.app.evil.example/_app/immutable/entry/start.js');
		expect(chooseStrategy(lookalike, origin, precached)).toBe('passthrough');
	});

	it('passes through same-origin files that were not precached', () => {
		expect(chooseStrategy(req('/unknown.json'), origin, precached)).toBe('passthrough');
	});
});

describe('cache naming', () => {
	it('versions the cache name', () => {
		expect(cacheName('abc')).toBe('pint-marten-abc');
	});

	it('marks only older pint-marten caches as stale', () => {
		expect(isStaleCache('pint-marten-old', 'new')).toBe(true);
		expect(isStaleCache('pint-marten-new', 'new')).toBe(false);
		expect(isStaleCache('someone-elses-cache', 'new')).toBe(false);
	});
});

describe('precachePaths', () => {
	it('makes paths absolute, including the prerendered home page', () => {
		expect(precachePaths([{ path: '' }, { path: '_app/immutable/entry/start.js' }])).toEqual([
			'/',
			'/_app/immutable/entry/start.js'
		]);
	});

	it('skips host config files the browser can never fetch', () => {
		expect(
			precachePaths([{ path: '_headers' }, { path: '_redirects' }, { path: 'robots.txt' }])
		).toEqual(['/robots.txt']);
	});
});
