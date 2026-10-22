/** Distance for display, in miles (feet under a tenth of a mile). */
export function formatDistance(meters: number): string {
	const miles = meters / 1609.344;
	if (miles < 0.1) return `${Math.round((meters * 3.28084) / 10) * 10} ft`;
	return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** User-facing text for a failed geolocation request, by `GeolocationPositionError.code`. */
export function locationErrorMessage(err: { code: number }): string {
	switch (err.code) {
		case 1: // PERMISSION_DENIED
			return 'Location permission is off for this site. Allow it in your browser’s site settings (and for the browser in your phone’s location settings), or pan the map instead.';
		case 3: // TIMEOUT
			return 'Finding your location took too long. Try again, or pan the map instead.';
		default: // POSITION_UNAVAILABLE
			return 'Your phone couldn’t work out where you are. Check that location services are on, or pan the map instead.';
	}
}
