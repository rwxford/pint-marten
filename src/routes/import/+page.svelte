<script lang="ts">
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { applyImport, type ApplyResult } from '#lib/data/apply.ts';
	import { getDb } from '#lib/data/db.ts';
	import type { FileParseResult } from '#lib/import/file.ts';
	import {
		FIELDS,
		applyMapping,
		missingRequired,
		type ColumnMapping,
		type FieldKey,
		type MappingOptions
	} from '#lib/import/generic.ts';
	import type { ParsedImport, RowError } from '#lib/import/types.ts';
	import ParseWorker from '#lib/import/parse.worker.ts?worker';

	type State =
		| { step: 'pick' }
		| { step: 'parsing'; fileName: string }
		| { step: 'preview'; fileName: string; parsed: ParsedImport }
		| {
				step: 'map';
				fileName: string;
				headers: string[];
				rows: string[][];
				mapping: ColumnMapping;
				options: MappingOptions;
		  }
		| { step: 'importing'; fileName: string }
		| { step: 'done'; fileName: string; result: ApplyResult; errors: RowError[] }
		| { step: 'error'; message: string };

	let ui = $state<State>({ step: 'pick' });
	let worker: Worker | undefined;

	onDestroy(() => worker?.terminate());

	function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		ui = { step: 'parsing', fileName: file.name };
		worker?.terminate();
		worker = new ParseWorker();
		worker.onmessage = (e: MessageEvent<FileParseResult>) => {
			const r = e.data;
			if (r.kind === 'error') ui = { step: 'error', message: r.message };
			else if (r.kind === 'records')
				ui = { step: 'preview', fileName: file.name, parsed: r.parsed };
			else ui = { step: 'map', fileName: file.name, ...r };
			worker?.terminate();
			worker = undefined;
		};
		worker.onerror = () => {
			ui = { step: 'error', message: 'This file could not be read.' };
		};
		worker.postMessage(file);
	}

	async function runImport(parsed: ParsedImport, fileName: string) {
		ui = { step: 'importing', fileName };
		try {
			const result = await applyImport(getDb(), parsed, fileName);
			ui = { step: 'done', fileName, result, errors: parsed.errors };
		} catch {
			ui = { step: 'error', message: 'Saving to this device failed. Nothing was imported.' };
		}
	}

	function summarize(parsed: ParsedImport) {
		const drinks = new Set(parsed.records.map((r) => `${r.producer.name}|${r.drink.name}`));
		const venues = new Set(parsed.records.filter((r) => r.venue).map((r) => r.venue!.name));
		const dates = parsed.records
			.map((r) => r.date?.slice(0, 10))
			.filter(Boolean)
			.sort();
		return {
			checkins: parsed.records.length,
			drinks: drinks.size,
			venues: venues.size,
			first: dates[0] ?? null,
			last: dates.at(-1) ?? null
		};
	}

	function setColumn(key: FieldKey, value: string) {
		if (ui.step !== 'map') return;
		ui.mapping[key] = value === '' ? null : Number(value);
	}

	const n = (v: number) => v.toLocaleString('en-US');
</script>

<main class="page">
	<h1>Import history</h1>

	{#if ui.step === 'pick' || ui.step === 'error'}
		<p>
			Choose an export from a beer-tracking app or a spreadsheet saved as CSV. Untappd exports (CSV
			or JSON) are recognized automatically; for anything else you'll match up the columns.
		</p>
		{#if ui.step === 'error'}
			<p class="error" role="alert">{ui.message}</p>
		{/if}
		<label class="button button-primary file">
			Choose file
			<input
				type="file"
				accept=".csv,.tsv,.txt,.json,text/csv,application/json"
				onchange={onFile}
			/>
		</label>
		<p class="muted">The file is read on this device and never uploaded.</p>
	{:else if ui.step === 'parsing' || ui.step === 'importing'}
		<p role="status">
			{ui.step === 'parsing' ? 'Reading' : 'Saving'}
			{ui.fileName}…
		</p>
	{:else if ui.step === 'preview'}
		{@const s = summarize(ui.parsed)}
		{@const parsed = ui.parsed}
		{@const fileName = ui.fileName}
		<section class="card" aria-labelledby="preview-heading">
			<h2 id="preview-heading">Untappd export</h2>
			<dl class="stat-grid">
				<div>
					<dt>Check-ins</dt>
					<dd>{n(s.checkins)}</dd>
				</div>
				<div>
					<dt>Drinks</dt>
					<dd>{n(s.drinks)}</dd>
				</div>
				<div>
					<dt>Venues</dt>
					<dd>{n(s.venues)}</dd>
				</div>
			</dl>
			{#if s.first}<p class="muted">{s.first} to {s.last}</p>{/if}
			{#if parsed.errors.length}
				<p class="error">
					{n(parsed.errors.length)} rows can't be imported (details after import).
				</p>
			{/if}
			<p class="muted">
				Only drinks, producers, venues, dates, ratings and serving types are kept. Comments, photos
				and tagged friends are left out.
			</p>
			<p class="actions">
				<button
					class="button button-primary"
					type="button"
					onclick={() => runImport(parsed, fileName)}
				>
					Import {n(s.checkins)} check-ins
				</button>
				<button class="button" type="button" onclick={() => (ui = { step: 'pick' })}>Cancel</button>
			</p>
		</section>
	{:else if ui.step === 'map'}
		{@const missing = missingRequired(ui.mapping)}
		{@const sample = applyMapping(ui.rows.slice(0, 5), ui.mapping, ui.options).records}
		{@const map = ui}
		<section class="card" aria-labelledby="map-heading">
			<h2 id="map-heading">Match columns</h2>
			<p class="muted">{map.fileName} · {n(map.rows.length)} rows</p>
			<div class="fields">
				{#each FIELDS as field (field.key)}
					<label>
						<span>{field.label}{field.required ? ' *' : ''}</span>
						<select
							value={map.mapping[field.key] === null ? '' : String(map.mapping[field.key])}
							onchange={(e) => setColumn(field.key, e.currentTarget.value)}
						>
							<option value="">— not in file —</option>
							{#each map.headers as header, i (i)}
								<option value={String(i)}>{header || `Column ${i + 1}`}</option>
							{/each}
						</select>
					</label>
				{/each}
				<label>
					<span>Date format</span>
					<select bind:value={map.options.dateOrder}>
						<option value="mdy">Month/Day/Year</option>
						<option value="dmy">Day/Month/Year</option>
					</select>
				</label>
			</div>

			<h3>Preview</h3>
			{#if missing.length}
				<p class="error">Choose a column for: {missing.join(', ')}</p>
			{:else}
				<ul class="preview">
					{#each sample as rec (rec.sourceRowId)}
						<li>
							<strong>{rec.drink.name}</strong> — {rec.producer.name}
							<span class="muted">
								· {rec.drink.category}{rec.drink.abv !== null
									? ` · ${rec.drink.abv}%`
									: ''}{rec.venue ? ` · ${rec.venue.name}` : ''}{rec.date
									? ` · ${rec.date.slice(0, 10)}`
									: ''}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			<p class="actions">
				<button
					class="button button-primary"
					type="button"
					disabled={missing.length > 0}
					onclick={() => runImport(applyMapping(map.rows, map.mapping, map.options), map.fileName)}
				>
					Import {n(map.rows.length)} rows
				</button>
				<button class="button" type="button" onclick={() => (ui = { step: 'pick' })}>Cancel</button>
			</p>
		</section>
	{:else if ui.step === 'done'}
		{@const r = ui.result}
		<section class="card" aria-labelledby="done-heading">
			<h2 id="done-heading">Imported</h2>
			<dl class="stat-grid">
				<div>
					<dt>Added</dt>
					<dd>{n(r.added)}</dd>
				</div>
				<div>
					<dt>Already had</dt>
					<dd>{n(r.duplicates)}</dd>
				</div>
				<div>
					<dt>New drinks</dt>
					<dd>{n(r.newDrinks)}</dd>
				</div>
				<div>
					<dt>New venues</dt>
					<dd>{n(r.newVenues)}</dd>
				</div>
			</dl>
			{#if r.reviewItems > 0}
				<p>
					<a href={resolve('/review')}
						>{r.reviewItems} possible duplicate{r.reviewItems === 1 ? '' : 's'} to review</a
					>
				</p>
			{/if}
			{#if ui.errors.length}
				<details>
					<summary class="error">{n(ui.errors.length)} rows skipped or partly imported</summary>
					<ul>
						{#each ui.errors.slice(0, 50) as err, i (i)}
							<li>Row {err.row}: {err.message}</li>
						{/each}
					</ul>
				</details>
			{/if}
			<p class="actions">
				<a class="button button-primary" href={resolve('/')}>Done</a>
				<button class="button" type="button" onclick={() => (ui = { step: 'pick' })}>
					Import another file
				</button>
			</p>
		</section>
	{/if}
</main>

<style>
	.file input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.file:focus-within {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
	}

	.fields label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	select {
		min-height: 2.5rem;
		font: inherit;
		color: inherit;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0 0.5rem;
	}

	h3 {
		margin-top: 1.25rem;
		font-size: 1rem;
	}

	.preview {
		padding-left: 1.25rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}
</style>
