/** Distance for display, in miles (feet under a tenth of a mile). */
export function formatDistance(meters: number): string {
	const miles = meters / 1609.344;
	if (miles < 0.1) return `${Math.round((meters * 3.28084) / 10) * 10} ft`;
	return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
