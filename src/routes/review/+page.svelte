<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '#lib/data/db.ts';
	import { keepSeparate, mergeReview, openReviews, type ReviewEntry } from '#lib/data/review.ts';

	let entries = $state<ReviewEntry[] | null>(null);
	// Said after a merge removed drinks you'd logged in the app that an import now covers.
	let notice = $state<string | null>(null);

	async function load() {
		entries = await openReviews(getDb());
	}

	onMount(load);

	async function merge(id: number) {
		const removed = await mergeReview(getDb(), id);
		notice = removed
			? removed === 1
				? 'Merged. 1 drink you logged in the app was the same check-in as an imported one, so it was removed.'
				: `Merged. ${removed} drinks you logged in the app were the same check-ins as imported ones, so they were removed.`
			: null;
		await load();
	}

	async function separate(id: number) {
		notice = null;
		await keepSeparate(getDb(), id);
		await load();
	}

	const unit = (kind: ReviewEntry['item']['kind'], count: number) =>
		kind === 'drink'
			? `${count} check-in${count === 1 ? '' : 's'}`
			: `${count} drink${count === 1 ? '' : 's'}`;
</script>

<main class="page">
	<h1>Possible duplicates</h1>
	<p class="muted">
		These names are close to something you already have. Merge them if they're the same, or keep
		them separate.
	</p>

	<p class="notice" aria-live="polite">{notice ?? ''}</p>

	{#if entries && entries.length === 0}
		<p class="card" role="status">Nothing to review.</p>
	{:else if entries}
		<ul class="list">
			{#each entries as entry (entry.item.id)}
				<li class="card">
					<p class="kind muted">{entry.item.kind === 'drink' ? 'Drink' : 'Producer'}</p>
					<p>
						Is <strong>{entry.newName}</strong>
						<span class="muted">({unit(entry.item.kind, entry.newCount)})</span>
						the same as <strong>{entry.candidateName}</strong>
						<span class="muted">({unit(entry.item.kind, entry.candidateCount)})</span>{entry.context
							? ` from ${entry.context}`
							: ''}?
					</p>
					<p class="actions">
						<button
							class="button button-primary"
							type="button"
							onclick={() => merge(entry.item.id)}
						>
							Same — merge
						</button>
						<button class="button" type="button" onclick={() => separate(entry.item.id)}>
							Different
						</button>
					</p>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.notice:empty {
		display: none;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.kind {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
