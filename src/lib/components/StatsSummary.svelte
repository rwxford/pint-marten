<script lang="ts">
	import type { Stats } from '#lib/data/stats.ts';

	let { stats }: { stats: Stats } = $props();

	const n = (value: number) => value.toLocaleString('en-US');
	const count = (value: number, one: string, many = `${one}s`) =>
		`${n(value)} ${value === 1 ? one : many}`;
	const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
</script>

<dl class="stat-grid">
	<div>
		<dt>Check-ins</dt>
		<dd>{n(stats.consumptions)}</dd>
	</div>
	<div>
		<dt>Drinks</dt>
		<dd>{n(stats.drinks)}</dd>
	</div>
	<div>
		<dt>Producers</dt>
		<dd>{n(stats.producers)}</dd>
	</div>
	<div>
		<dt>Venues</dt>
		<dd>{n(stats.venues)}</dd>
	</div>
</dl>
<p class="muted">
	{count(stats.byCategory.beer, 'beer')} · {count(stats.byCategory.cider, 'cider')} ·
	{count(stats.byCategory.mead, 'mead')} · {n(stats.byCategory.other)} other ·
	{n(stats.naDrinks)} non-alcoholic
	<br />
	{day(stats.firstDate)} to {day(stats.lastDate)}
</p>
