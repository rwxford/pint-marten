<script lang="ts">
	import { resolve } from '$app/paths';
	import '../app.css';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const links = [
		{ path: '/', label: 'Home' },
		{ path: '/import', label: 'Import' },
		{ path: '/review', label: 'Review' }
	] as const;
</script>

<svelte:head>
	<title>Pint Marten</title>
</svelte:head>

<header>
	<nav aria-label="Main">
		<a class="brand" href={resolve('/')}>
			<img src="/icons/icon.svg" alt="" width="28" height="28" />
			Pint Marten
		</a>
		<ul>
			{#each links as link (link.path)}
				<li>
					<a
						href={resolve(link.path)}
						aria-current={page.url.pathname === resolve(link.path) ? 'page' : undefined}
						>{link.label}</a
					>
				</li>
			{/each}
		</ul>
	</nav>
</header>

{@render children()}

<style>
	header {
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
		padding-top: env(safe-area-inset-top);
	}

	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		max-width: 40rem;
		margin: 0 auto;
		padding: 0.5rem 1rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		color: var(--color-text);
		text-decoration: none;
	}

	.brand img {
		border-radius: 22%;
	}

	ul {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ul a {
		display: block;
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
		color: var(--color-muted);
		text-decoration: none;
	}

	ul a[aria-current='page'] {
		color: var(--color-text);
		background: var(--color-bg);
	}
</style>
