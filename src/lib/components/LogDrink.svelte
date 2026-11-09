<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '#lib/data/db.ts';
	import {
		drinkOptions,
		filterOptions,
		fromDateTimeLocal,
		logDrink,
		SERVING_TYPES,
		toDateTimeLocal,
		venueOptions,
		type DrinkOption,
		type LogResult,
		type MapPlace,
		type VenueOption
	} from '#lib/data/manual.ts';
	import { parseAbv, parseRating } from '#lib/import/values.ts';

	interface Props {
		/** The map venue the drink was had at; without one, a venue from history can be chosen. */
		place?: MapPlace | null;
		onlogged: (result: LogResult, summary: string) => void;
		oncancel?: () => void;
	}

	let { place = null, onlogged, oncancel }: Props = $props();

	let drinks = $state<DrinkOption[]>([]);
	let venues = $state<VenueOption[]>([]);

	let drinkQuery = $state('');
	let chosenDrink = $state<DrinkOption | null>(null);
	let producer = $state('');
	let style = $state('');
	let abv = $state('');

	let venueQuery = $state('');
	let chosenVenue = $state<VenueOption | null>(null);

	let servingType = $state('');
	let rating = $state('');
	let when = $state(toDateTimeLocal(new Date()));
	let error = $state<string | null>(null);
	let saving = $state(false);

	const drinkMatches = $derived(chosenDrink ? [] : filterOptions(drinks, drinkQuery));
	const venueMatches = $derived(place || chosenVenue ? [] : filterOptions(venues, venueQuery, 5));

	onMount(async () => {
		const db = getDb();
		[drinks, venues] = await Promise.all([drinkOptions(db), place ? [] : venueOptions(db)]);
	});

	function chooseDrink(d: DrinkOption) {
		chosenDrink = d;
		drinkQuery = d.name;
	}

	function clearDrink() {
		chosenDrink = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		const name = drinkQuery.trim();
		if (!chosenDrink && (!name || !producer.trim())) {
			error = 'Enter the drink’s name and who made it, or pick a drink from your history.';
			return;
		}
		const date = fromDateTimeLocal(when);
		if (!date) {
			error = 'Enter when you had it.';
			return;
		}
		const ratingValue = rating.trim() ? parseRating(rating) : null;
		if (rating.trim() && ratingValue === null) {
			error = 'Rating must be between 0 and 5.';
			return;
		}
		const abvValue = abv.trim() ? parseAbv(abv) : null;
		if (abv.trim() && abvValue === null) {
			error = 'ABV must be a percentage between 0 and 100.';
			return;
		}
		saving = true;
		try {
			const result = await logDrink(getDb(), {
				drink: chosenDrink
					? { drinkId: chosenDrink.id }
					: { name, producer, style: style || null, abv: abvValue },
				venue: place ? { place } : chosenVenue ? { venueId: chosenVenue.id } : null,
				date,
				rating: ratingValue,
				servingType: servingType || null
			});
			const at = place?.name ?? chosenVenue?.name;
			onlogged(result, `Logged ${chosenDrink?.name ?? name}${at ? ` at ${at}` : ''}.`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Couldn’t save the drink.';
		} finally {
			saving = false;
		}
	}
</script>

<form class="log" onsubmit={submit} aria-label="Log a drink" novalidate>
	<label class="field">
		<span>Drink</span>
		<input
			type="text"
			bind:value={drinkQuery}
			oninput={clearDrink}
			autocomplete="off"
			maxlength="300"
			placeholder="Search your history or type a new drink"
		/>
	</label>
	{#if drinkMatches.length}
		<ul class="options" aria-label="Drinks you’ve had">
			{#each drinkMatches as d (d.id)}
				<li>
					<button type="button" class="option" onclick={() => chooseDrink(d)}>
						<span class="name">{d.name}</span>
						<span class="muted small">{d.producer}{d.style ? ` · ${d.style}` : ''}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if chosenDrink}
		<p class="chosen">
			{chosenDrink.producer}{chosenDrink.style ? ` · ${chosenDrink.style}` : ''} · already in your history
		</p>
	{:else}
		<label class="field">
			<span>Made by</span>
			<input type="text" bind:value={producer} autocomplete="off" maxlength="300" />
		</label>
		<div class="row">
			<label class="field">
				<span>Style <span class="muted">(optional)</span></span>
				<input type="text" bind:value={style} autocomplete="off" maxlength="100" />
			</label>
			<label class="field narrow">
				<span>ABV % <span class="muted">(optional)</span></span>
				<input type="text" inputmode="decimal" bind:value={abv} autocomplete="off" />
			</label>
		</div>
	{/if}

	{#if !place}
		<label class="field">
			<span>Where <span class="muted">(optional)</span></span>
			<input
				type="text"
				bind:value={venueQuery}
				oninput={() => (chosenVenue = null)}
				autocomplete="off"
				placeholder="A venue from your history"
			/>
		</label>
		{#if venueMatches.length}
			<ul class="options" aria-label="Venues you’ve been to">
				{#each venueMatches as v (v.id)}
					<li>
						<button
							type="button"
							class="option"
							onclick={() => {
								chosenVenue = v;
								venueQuery = v.name;
							}}
						>
							<span class="name">{v.name}</span>
							{#if v.city}<span class="muted small">{v.city}</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if venueQuery.trim() && !chosenVenue && !venueMatches.length}
			<p class="muted small">
				No venue by that name in your history. To log at a new place, pick it on the map.
			</p>
		{/if}
	{/if}

	<div class="row">
		<label class="field">
			<span>Serving</span>
			<select bind:value={servingType}>
				<option value="">—</option>
				{#each SERVING_TYPES as s (s)}<option value={s}>{s}</option>{/each}
			</select>
		</label>
		<label class="field narrow">
			<span>Rating (0–5)</span>
			<input type="text" inputmode="decimal" bind:value={rating} autocomplete="off" />
		</label>
	</div>

	<label class="field">
		<span>When</span>
		<input type="datetime-local" bind:value={when} required />
	</label>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="actions">
		<button class="button button-primary" type="submit" disabled={saving}>Log drink</button>
		{#if oncancel}
			<button class="button" type="button" onclick={oncancel}>Cancel</button>
		{/if}
	</div>
</form>

<style>
	.log {
		display: grid;
		gap: 0.75rem;
	}

	.error {
		margin: 0;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.field > span {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.narrow {
		flex: 0 1 8rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	input,
	select {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.options {
		margin: -0.5rem 0 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.option {
		display: grid;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: 0;
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.options li:first-child .option {
		border-top: 0;
	}

	.name {
		font-weight: 600;
	}

	.chosen {
		margin: -0.5rem 0 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.small {
		font-size: 0.8125rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
