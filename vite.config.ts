import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Every page is prerendered; output is plain static files (no server).
			adapter: adapter({ strict: true }),
			// Prerendered pages get this policy as a <meta> tag, with hashes added for SvelteKit's
			// own inline scripts. Add third-party hosts to connect-src/img-src only when a feature
			// needs them (spec §5, "Network calls").
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['none'],
					'script-src': ['self'],
					'style-src': ['self'],
					// SvelteKit's route announcer (for screen readers) is the only inline style
					// attribute. Allow exactly that string by hash; a SvelteKit update that changes it
					// fails the CSP e2e test rather than silently breaking.
					'style-src-attr': [
						'unsafe-hashes',
						'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='
					],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'manifest-src': ['self'],
					'worker-src': ['self'],
					'base-uri': ['none'],
					'form-action': ['self'],
					'object-src': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
