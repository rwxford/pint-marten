/**
 * Third-party services the map uses. Every host here must also appear in the CSP in
 * vite.config.ts; nothing else is contacted.
 */

/** OpenFreeMap: free vector tiles from OpenStreetMap data, no API key. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const TILE_ORIGIN = 'https://tiles.openfreemap.org';

/** Public Overpass API instance for querying OpenStreetMap features. */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const OVERPASS_ORIGIN = 'https://overpass-api.de';

/** Searching is disabled below this zoom so a single query can't cover a huge area. */
export const MIN_SEARCH_ZOOM = 12;

/** Shown before the user has located themselves or panned anywhere. */
export const DEFAULT_VIEW = { center: [-96, 38] as [number, number], zoom: 3 };

/** First "Near me" attempt: Wi-Fi and cell positioning, a recent cached fix is fine. */
export const QUICK_FIX: PositionOptions = {
	enableHighAccuracy: false,
	timeout: 10_000,
	maximumAge: 60_000
};

/** Fallback when the quick attempt fails: GPS, with time for a cold fix. */
export const GPS_FIX: PositionOptions = {
	enableHighAccuracy: true,
	timeout: 45_000,
	maximumAge: 0
};
