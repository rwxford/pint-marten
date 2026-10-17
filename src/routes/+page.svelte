<script lang="ts">
	import { version } from '$app/env';
</script>

<main>
	<img class="logo" src="/icons/icon.svg" alt="" width="96" height="96" />
	<h1>Pint Marten</h1>
	<p class="tagline">
		Find beers, ciders and meads you haven't had — and places you haven't been — within walking or
		driving distance.
	</p>

	<section aria-labelledby="status-heading">
		<h2 id="status-heading">Coming soon</h2>
		<ul>
			<li>Import your history from a tracking-app export or a spreadsheet</li>
			<li>Walk or drive: see what's new to you within a time limit</li>
			<li>Non-alcoholic and beer / cider / mead filters</li>
			<li>Airport mode for IAD, DCA, BWI, CLT, ATL and DEN</li>
		</ul>
		<p class="note">Your data stays on this device.</p>
	</section>

	<footer>
		<a href="https://github.com/rwxford/pint-marten">Source (AGPL-3.0)</a>
		<span aria-hidden="true">·</span>
		<span>Build {version}</span>
	</footer>
</main>

<style>
	main {
		max-width: 36rem;
		margin: 0 auto;
		padding: max(2rem, env(safe-area-inset-top)) 1rem 2rem;
	}

	.logo {
		display: block;
		border-radius: 22%;
	}

	h1 {
		margin: 1rem 0 0.25rem;
		font-size: 2rem;
		color: var(--color-accent);
	}

	.tagline {
		margin-top: 0;
		font-size: 1.125rem;
	}

	section {
		margin-top: 2rem;
		padding: 1rem 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.125rem;
	}

	ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.note {
		margin-bottom: 0;
		color: var(--color-muted);
	}

	footer {
		margin-top: 2rem;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	a {
		color: var(--color-accent);
	}
</style>
