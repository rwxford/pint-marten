# Pint Marten

Find beers, ciders and meads you haven't had — and places you haven't been — within
walking or driving distance. Includes an airport mode that works out what you can reach
before boarding.

Pint Marten is a local-first PWA (progressive web app): your drinking history stays on
your device. Seed it by importing an export from another tracking app or a spreadsheet.

**Status:** early development (milestone M1, app scaffold). See
[`docs/SPEC.md`](docs/SPEC.md) for the product and technical spec.

## Development

Requires Node.js 22.17+ and [pnpm](https://pnpm.io) (version pinned in `package.json`; `corepack enable` installs it).

```sh
pnpm install
pnpm dev            # dev server at http://localhost:5173
pnpm build          # static site in build/
pnpm preview        # serve the production build at http://localhost:4173
```

Checks (the same ones CI runs):

```sh
pnpm lint           # Prettier + ESLint
pnpm check          # svelte-check + service worker typecheck
pnpm test:unit --run
pnpm test:e2e       # builds, then runs Playwright against the production build
```

`pnpm test:e2e` needs a Playwright Chromium (`pnpm exec playwright install chromium`). To use
an existing Chromium instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path.

### How it's put together

- **SvelteKit, fully prerendered** with `@sveltejs/adapter-static`. There is no server; `build/`
  can be served by any static host (Cloudflare Pages is the plan; `static/_headers` holds its
  security headers).
- **Offline support** comes from SvelteKit's built-in service worker (`src/service-worker/`).
  Request-handling rules live in `src/lib/sw/strategy.ts` so they can be unit tested.
- **Content Security Policy** is set in `vite.config.ts` and emitted as a `<meta>` tag with
  hashes for SvelteKit's inline bootstrap script. Only `'self'` is allowed today; add a host to
  `connect-src`/`img-src` only when a feature needs it.

## Deployment

The app is a static site, so any static host works. Two are configured:

- **Vercel** (`vercel.json`): build settings, clean URLs and security headers. Connect the repo in
  Vercel; every pull request gets a preview link.
- **Cloudflare Pages** (`static/_headers`): set the build command to `pnpm build`, the output
  directory to `build`, and `NODE_VERSION` to 22.17 or newer.

Both header sets are equivalent and add what a `<meta>` CSP can't (`frame-ancestors`), plus
nosniff, a strict referrer policy and a permissions policy. Keep them in sync when either changes.

## License

[AGPL-3.0](LICENSE). See §9 of the spec for the licensing and contribution model.
