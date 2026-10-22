<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
	import { onDestroy, onMount } from 'svelte';
	import { getDb } from '#lib/data/db.ts';
	import { DEFAULT_VIEW, MAP_STYLE_URL, MIN_SEARCH_ZOOM, OVERPASS_URL } from '#lib/map/config.ts';
	import { formatDistance, locationErrorMessage } from '#lib/map/format.ts';
	import { AreaTooLargeError, cachedVenues, loadVenues } from '#lib/venues/cache.ts';
	import { distanceMeters, visitedOsmIds, type KnownVenue } from '#lib/venues/match.ts';
	import { fetchOverpass, OverpassError } from '#lib/venues/osm.ts';
	import { VENUE_KIND_LABELS, type Bbox, type OsmVenue } from '#lib/venues/types.ts';

	const VIEW_KEY = 'pint-marten:map-view';
	const LIST_LIMIT = 50;

	interface View {
		center: [number, number];
		zoom: number;
		bbox: Bbox;
	}

	let container = $state<HTMLDivElement>();
	let map: MapLibreMap | undefined;
	// `map` isn't reactive, so effects that drive map layers depend on this instead.
	let mapReady = $state(false);
	// The selection actually applied to the map layer, read back from MapLibre (also lets tests
	// confirm the highlight without inspecting the canvas).
	let highlighted = $state<string | null>(null);
	let mapError = $state<string | null>(null);
	let view = $state<View | null>(null);
	let venues = $state<OsmVenue[]>([]);
	// Imported venues with coordinates, for "visited" matching. Searches await this so a fast
	// tap on "Near me" can't run before history has loaded.
	let knownLoaded: Promise<KnownVenue[]> = Promise.resolve([]);
	let visited = $state<Set<string>>(new Set());
	let status = $state<string | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let onlyNew = $state(false);
	let selectedId = $state<string | null>(null);
	// Where distances are measured from: your location after "Near me", otherwise the center of
	// the last search. Selecting a venue moves the map but not this point.
	let origin = $state<{ lng: number; lat: number; you: boolean } | null>(null);

	const canSearch = $derived(!!view && view.zoom >= MIN_SEARCH_ZOOM && !busy);

	const listed = $derived.by(() => {
		const from = origin ?? (view ? { lng: view.center[0], lat: view.center[1] } : null);
		if (!from) return [];
		const { lng, lat } = from;
		return venues
			.filter((v) => !onlyNew || !visited.has(v.osmId))
			.map((v) => ({ v, d: distanceMeters(lat, lng, v.lat, v.lng) }))
			.sort((a, b) => a.d - b.d)
			.slice(0, LIST_LIMIT);
	});

	const selected = $derived(venues.find((v) => v.osmId === selectedId) ?? null);

	function bboxAround(lng: number, lat: number, zoom: number): Bbox {
		// Roughly the visible area of a phone-sized map at this zoom.
		const half = 180 / 2 ** zoom;
		return { south: lat - half / 2, west: lng - half, north: lat + half / 2, east: lng + half };
	}

	function readSavedView(): { center: [number, number]; zoom: number } {
		try {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
			if (Array.isArray(saved?.center) && typeof saved.zoom === 'number') return saved;
		} catch {
			/* storage unavailable or corrupt; use the default */
		}
		return DEFAULT_VIEW;
	}

	function saveView(v: View) {
		try {
			localStorage.setItem(VIEW_KEY, JSON.stringify({ center: v.center, zoom: v.zoom }));
		} catch {
			/* not critical */
		}
	}

	function syncViewFromMap() {
		if (!map) return;
		const c = map.getCenter();
		const b = map.getBounds();
		view = {
			center: [c.lng, c.lat],
			zoom: map.getZoom(),
			bbox: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }
		};
		saveView(view);
	}

	function setViewWithoutMap(center: [number, number], zoom: number) {
		view = { center, zoom, bbox: bboxAround(center[0], center[1], zoom) };
		saveView(view);
	}

	function toFeatures() {
		return {
			type: 'FeatureCollection' as const,
			features: venues.map((v) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
				properties: { id: v.osmId, visited: visited.has(v.osmId), name: v.name }
			}))
		};
	}

	async function showCached() {
		if (!view) return;
		const known = await knownLoaded;
		venues = await cachedVenues(getDb(), view.bbox);
		visited = visitedOsmIds(venues, known);
	}

	async function search() {
		if (!view || busy) return;
		if (!origin?.you) origin = { lng: view.center[0], lat: view.center[1], you: false };
		busy = true;
		error = null;
		status = 'Searching OpenStreetMap…';
		try {
			const known = await knownLoaded;
			const result = await loadVenues(getDb(), view.bbox, (b) => fetchOverpass(b, OVERPASS_URL));
			venues = result.venues;
			visited = visitedOsmIds(venues, known);
			status = `${venues.length} venue${venues.length === 1 ? '' : 's'} in this area${result.fetched ? '' : ' (saved on this device)'}`;
		} catch (e) {
			status = null;
			error =
				e instanceof AreaTooLargeError || e instanceof OverpassError
					? e.message
					: 'Venue search failed. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	function nearMe() {
		if (!('geolocation' in navigator)) {
			error = 'Location is not available on this device.';
			return;
		}
		error = null;
		status = 'Finding your location…';
		navigator.geolocation.getCurrentPosition(
			async (pos) => {
				const center: [number, number] = [pos.coords.longitude, pos.coords.latitude];
				origin = { lng: center[0], lat: center[1], you: true };
				if (map) {
					map.jumpTo({ center, zoom: 14 });
					syncViewFromMap();
				} else {
					setViewWithoutMap(center, 14);
				}
				await search();
			},
			(err) => {
				status = null;
				error = locationErrorMessage(err);
			},
			{ enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 }
		);
	}

	function select(v: OsmVenue) {
		selectedId = v.osmId;
		map?.easeTo({ center: [v.lng, v.lat] });
	}

	// Read every dependency before the readiness check so each effect tracks them all, even on
	// its first run before the map has loaded.
	$effect(() => {
		const data = toFeatures();
		if (!mapReady || !map) return;
		(map.getSource('venues') as GeoJSONSource | undefined)?.setData(data);
	});

	$effect(() => {
		const id = selectedId ?? '';
		if (!mapReady || !map?.getLayer('venue-selected')) return;
		map.setFilter('venue-selected', ['==', ['get', 'id'], id]);
		const filter = map.getFilter('venue-selected');
		highlighted =
			Array.isArray(filter) && typeof filter[2] === 'string' && filter[2] ? filter[2] : null;
	});

	onMount(() => {
		const saved = readSavedView();
		let cancelled = false;
		knownLoaded = getDb()
			.venues.toArray()
			.then((all) =>
				all.flatMap((v) =>
					v.lat !== null && v.lng !== null ? [{ name: v.name, lat: v.lat, lng: v.lng }] : []
				)
			);

		(async () => {
			try {
				const maplibre = await import('maplibre-gl');
				if (cancelled || !container) return;
				maplibre.setWorkerUrl(workerUrl);
				// "Near me" may have run while the map library was loading; start from that view.
				const start = view ?? saved;
				map = new maplibre.Map({
					container,
					style: MAP_STYLE_URL,
					center: start.center,
					zoom: start.zoom,
					attributionControl: { compact: true }
				});
				map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
				map.on('load', () => {
					map!.addSource('venues', { type: 'geojson', data: toFeatures() });
					map!.addLayer({
						id: 'venue-points',
						type: 'circle',
						source: 'venues',
						paint: {
							'circle-radius': 7,
							'circle-color': ['case', ['get', 'visited'], '#8d948a', '#e9a23b'],
							'circle-stroke-width': 2,
							'circle-stroke-color': '#1f3a2e'
						}
					});
					map!.addLayer({
						id: 'venue-selected',
						type: 'circle',
						source: 'venues',
						filter: ['==', ['get', 'id'], ''],
						paint: {
							'circle-radius': 11,
							'circle-color': 'rgba(0,0,0,0)',
							'circle-stroke-width': 3,
							'circle-stroke-color': '#1f3a2e'
						}
					});
					map!.on('click', 'venue-points', (e) => {
						const id = e.features?.[0]?.properties?.id;
						if (typeof id === 'string') selectedId = id;
					});
					mapReady = true;
				});
				map.on('moveend', async () => {
					syncViewFromMap();
					await showCached();
				});
				syncViewFromMap();
			} catch {
				mapError = 'The map can’t be shown on this device, but venue search still works.';
				if (!view) setViewWithoutMap(saved.center, saved.zoom);
			}
			await showCached();
		})();

		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		mapReady = false;
		map?.remove();
	});
</script>

<svelte:head>
	<title>Map · Pint Marten</title>
</svelte:head>

<main class="map-page">
	<div
		class="map"
		bind:this={container}
		aria-label="Map of nearby venues"
		role="region"
		data-highlighted={highlighted ?? undefined}
	>
		{#if mapError}<p class="map-error">{mapError}</p>{/if}
	</div>

	<div class="page panel">
		<div class="toolbar">
			<button class="button button-primary" type="button" onclick={nearMe} disabled={busy}>
				Near me
			</button>
			<button class="button" type="button" onclick={search} disabled={!canSearch}>
				Search this area
			</button>
			<label class="toggle">
				<input type="checkbox" bind:checked={onlyNew} />
				New to me only
			</label>
		</div>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{:else if status}
			<p class="muted" role="status">{status}</p>
		{:else if view && view.zoom < MIN_SEARCH_ZOOM}
			<p class="muted">Zoom in, or tap “Near me”, to search for venues.</p>
		{/if}

		{#if selected}
			<section class="card selected" aria-label="Selected venue">
				<h2>{selected.name}</h2>
				<p class="muted">
					{VENUE_KIND_LABELS[selected.kind]} ·
					{visited.has(selected.osmId) ? 'You’ve been here' : 'New to you'}
				</p>
				{#if selected.openingHours}<p>Hours: {selected.openingHours}</p>{/if}
				{#if selected.website}
					<p>
						<a href={selected.website} rel="noopener noreferrer external" target="_blank">Website</a
						>
					</p>
				{/if}
			</section>
		{/if}

		{#if listed.length}
			<p class="muted small">
				Distances from {origin?.you ? 'your location' : 'the center of your search'}.
			</p>
			<ul class="venues" aria-label="Venues">
				{#each listed as { v, d } (v.osmId)}
					<li>
						<button
							type="button"
							class="venue"
							aria-pressed={v.osmId === selectedId}
							onclick={() => select(v)}
						>
							<span class="name">{v.name}</span>
							<span class="meta muted">{VENUE_KIND_LABELS[v.kind]} · {formatDistance(d)}</span>
							<span class="badge" class:visited={visited.has(v.osmId)}>
								{visited.has(v.osmId) ? 'Visited' : 'New'}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="muted small">
			Venue data © <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer"
				>OpenStreetMap contributors</a
			>. Searches send only the map area, never your history.
		</p>
	</div>
</main>

<style>
	.map {
		position: relative;
		height: 55vh;
		min-height: 18rem;
		background: var(--color-border);
	}

	.map-error {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		padding: 1rem;
		text-align: center;
	}

	.panel {
		padding-top: 1rem;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 2.75rem;
	}

	.selected h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.venues {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--color-border);
	}

	.venue {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.125rem 0.75rem;
		width: 100%;
		padding: 0.75rem 0.25rem;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.venue[aria-pressed='true'] {
		background: var(--color-surface);
	}

	.name {
		font-weight: 600;
	}

	.meta {
		grid-column: 1;
		font-size: 0.875rem;
	}

	.badge {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-accent-text);
		font-size: 0.75rem;
		font-weight: 700;
	}

	.badge.visited {
		background: var(--color-border);
		color: var(--color-text);
	}

	.small {
		font-size: 0.75rem;
	}
</style>
