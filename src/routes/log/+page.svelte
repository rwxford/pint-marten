<script lang="ts">
	import { resolve } from '$app/paths';
	import LogDrink from '#lib/components/LogDrink.svelte';

	let notice = $state<string | null>(null);
	// Re-creating the form clears it for the next drink.
	let formKey = $state(0);
</script>

<svelte:head>
	<title>Log a drink · Pint Marten</title>
</svelte:head>

<main class="page">
	<h1>Log a drink</h1>
	<p class="muted">
		Add a drink as you have it, so it stops showing as new without waiting for your next export. If
		a later import has the same check-in, the imported one replaces this.
	</p>
	{#if notice}<p role="status">{notice}</p>{/if}
	<section class="card">
		{#key formKey}
			<LogDrink
				onlogged={(_, summary) => {
					notice = summary;
					formKey++;
				}}
			/>
		{/key}
	</section>
	<p class="muted small">
		To log at a place you haven’t been before, pick it on the <a href={resolve('/map')}>map</a>.
	</p>
</main>

<style>
	h1 {
		margin: 0.5rem 0 0.25rem;
		font-size: 1.5rem;
	}

	.small {
		font-size: 0.875rem;
	}
</style>
