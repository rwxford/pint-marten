import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';
import { cacheName, chooseStrategy, isStaleCache, precachePaths } from '../lib/sw/strategy';

const CACHE = cacheName(version);
const PRECACHE = precachePaths([...immutable, ...assets, ...prerendered]);
const precached = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(names.filter((n) => isStaleCache(n, version)).map((n) => caches.delete(n)))
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const strategy = chooseStrategy(request, self.location.origin, precached);

	if (strategy === 'precache') {
		event.respondWith(
			caches
				.open(CACHE)
				.then((cache) => cache.match(request, { ignoreSearch: true }))
				.then((cached) => cached ?? fetch(request))
		);
	} else if (strategy === 'navigation') {
		event.respondWith(
			fetch(request).catch(async () => {
				const cache = await caches.open(CACHE);
				return (await cache.match('/')) ?? Response.error();
			})
		);
	}
});
