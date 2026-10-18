<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { version } from '$app/env';
	import StatsSummary from '#lib/components/StatsSummary.svelte';
	import { getDb } from '#lib/data/db.ts';
	import { deleteAllData, getStats, type Stats } from '#lib/data/stats.ts';

	let stats = $state<Stats | null>(null);

	onMount(async () => {
		stats = await getStats(getDb());
	});

	async function onDeleteAll() {
		if (!confirm('Delete all imported data from this device? This cannot be undone.')) return;
		await deleteAllData(getDb());
		stats = await getStats(getDb());
	}
</script>

<main class="page">
	<h1>Pint Marten</h1>
	<p class="tagline">
		Find beers, ciders and meads you haven't had — and places you haven't been — within walking or
		driving distance.
	</p>

	{#if stats && stats.consumptions > 0}
		<section class="card" aria-labelledby="data-heading">
			<h2 id="data-heading">Your history</h2>
			<StatsSummary {stats} />
			{#if stats.openReviews > 0}
				<p>
					<a href={resolve('/review')}
						>{stats.openReviews} possible duplicate{stats.openReviews === 1 ? '' : 's'} to review</a
					>
				</p>
			{/if}
			<p class="actions">
				<a class="button" href={resolve('/import')}>Import more</a>
				<button class="button button-danger" type="button" onclick={onDeleteAll}>
					Delete all data
				</button>
			</p>
		</section>
	{:else if stats}
		<section class="card">
			<h2>Start with your history</h2>
			<p>
				Import an export from a beer-tracking app or a spreadsheet so Pint Marten knows what you've
				already had and where.
			</p>
			<p><a class="button button-primary" href={resolve('/import')}>Import history</a></p>
		</section>
	{/if}

	<section class="card" aria-labelledby="status-heading">
		<h2 id="status-heading">Coming soon</h2>
		<ul>
			<li>Walk or drive: see what's new to you within a time limit</li>
			<li>Non-alcoholic and beer / cider / mead filters</li>
			<li>Airport mode for IAD, DCA, BWI, CLT, ATL and DEN</li>
		</ul>
		<p class="muted">Your data stays on this device.</p>
	</section>

	<footer class="muted">
		<a href="https://github.com/rwxford/pint-marten">Source (AGPL-3.0)</a>
		<span aria-hidden="true">·</span>
		<span>Build {version}</span>
	</footer>
</main>

<style>
	h1 {
		margin: 0.5rem 0 0.25rem;
		font-size: 2rem;
		color: var(--color-accent);
	}

	.tagline {
		margin-top: 0;
		font-size: 1.125rem;
	}

	h2 {
		font-size: 1.125rem;
	}

	ul {
		padding-left: 1.25rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	footer {
		margin-top: 2rem;
		font-size: 0.875rem;
	}
</style>
