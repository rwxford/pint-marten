/**
 * Decides how the service worker handles a request. Kept free of service-worker globals so it
 * can be unit tested.
 *
 * - `precache`: a build or static file cached at install time; served cache-first.
 * - `navigation`: a page load; network-first so updates appear, falling back to the cached app
 *   shell when offline.
 * - `passthrough`: everything else (non-GET, cross-origin APIs, uncached files) goes straight to
 *   the network untouched. Cross-origin responses are never cached here, so third-party data can't
 *   be replayed from the cache.
 */
export type Strategy = 'precache' | 'navigation' | 'passthrough';

export interface RequestInfo {
	method: string;
	url: string;
	mode: RequestMode;
}

export function chooseStrategy(
	request: RequestInfo,
	origin: string,
	precached: ReadonlySet<string>
): Strategy {
	if (request.method !== 'GET') return 'passthrough';

	const url = new URL(request.url);
	if (url.origin !== origin) return 'passthrough';

	if (precached.has(url.pathname)) return 'precache';
	if (request.mode === 'navigate') return 'navigation';
	return 'passthrough';
}

/** Cache names are versioned by build so each deploy starts with a clean cache. */
export function cacheName(version: string): string {
	return `pint-marten-${version}`;
}

/** True for caches this app created in an earlier build, which can be deleted on activate. */
export function isStaleCache(name: string, currentVersion: string): boolean {
	return name.startsWith('pint-marten-') && name !== cacheName(currentVersion);
}

// Host configuration files that live in static/ but are never served to browsers. Precaching one
// would 404 and make the whole service worker install fail.
const HOST_CONFIG_FILES = new Set(['_headers', '_redirects']);

/** Turns SvelteKit's base-relative manifest paths into the absolute paths to precache. */
export function precachePaths(entries: ReadonlyArray<{ path: string }>): string[] {
	return entries.filter(({ path }) => !HOST_CONFIG_FILES.has(path)).map(({ path }) => `/${path}`);
}
