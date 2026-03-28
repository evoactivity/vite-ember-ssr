# vite-ember-ssr

> [!WARNING]
> **EXPERIMENTAL** — This project is in early development and targets **compatless** Ember apps only (no `@embroider/compat`, no `ember-cli-build.js`, no `classicEmberSupport()`). APIs will change. Do not use in production.

Vite plugin and SSR runtime for Ember.js applications. Uses [HappyDOM](https://github.com/nicedayfor/happy-dom) for server-side rendering — no FastBoot, no VM sandbox.

## Architecture

- **HappyDOM Window** provides a full per-request browser-like environment. Ember runs directly in the Node.js process with globals swapped per request.
- **`Application.visit(url)`** drives the entire render cycle server-side.
- **No hydration yet** — the client boots normally and replaces SSR content. SSR provides the initial visual while JS loads.
- **Shoebox** — fetch responses captured during SSR are serialized into the HTML and replayed on the client to avoid duplicate API requests.

## Requirements

- Compatless Ember app using `@embroider/vite` (the `ember()` plugin only)
- [`ember-strict-application-resolver`](https://github.com/nicedayfor/ember-strict-application-resolver) instead of classic `ember-resolver`
- Config as a direct ES module import (no `<meta>` tag, no `@embroider/config-meta-loader`)
- Vite 6+ or 7+
- Node 22+

## Packages

This is a pnpm monorepo with three packages:

| Package                   | Description                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `packages/vite-ember-ssr` | Core library — Vite plugin, server runtime, client utilities |
| `packages/test-app`       | Ember app used for testing                                   |
| `packages/test-server`    | Fastify SSR server with test suites                          |

## Library exports

`vite-ember-ssr` exposes three entry points:

### `vite-ember-ssr/vite-plugin`

```js
import { emberSsr } from 'vite-ember-ssr/vite-plugin';
```

Vite plugin for the SSR build config. Writes a `package.json` with `"type": "module"` to the output directory so Node treats the bundle as ESM.

### `vite-ember-ssr/server`

```js
import { renderEmberApp, assembleHTML } from 'vite-ember-ssr/server';
```

- **`renderEmberApp(options)`** — renders an Ember app at a given URL using HappyDOM. Accepts `{ url, createApp, shoebox? }`. Returns `{ head, body, statusCode, error }`.
- **`assembleHTML(template, renderResult)`** — replaces `<!-- VITE_EMBER_SSR_HEAD -->` and `<!-- VITE_EMBER_SSR_BODY -->` markers in the HTML template with rendered content.

### `vite-ember-ssr/client`

```js
import { installShoebox, cleanupSSRContent } from 'vite-ember-ssr/client';
```

- **`installShoebox()`** — reads the shoebox `<script>` from the DOM, monkey-patches `fetch` to replay cached responses, auto-restores original `fetch` when all entries are consumed.
- **`cleanupSSRContent()`** — removes SSR-rendered DOM nodes between boundary markers before client Ember boots.
- **`cleanupShoebox()`** — manual escape hatch to restore original `fetch` immediately.

## Usage

### HTML template

Add SSR markers to `index.html`:

```html
<head>
  <!-- VITE_EMBER_SSR_HEAD -->
</head>
<body>
  <!-- VITE_EMBER_SSR_BODY -->
  <script type="module" src="/app/entry.ts"></script>
</body>
```

### SSR entry (`app/app-ssr.ts`)

Export a factory that creates the Ember app with `autoboot: false`:

```ts
import EmberApp from 'ember-strict-application-resolver';
import config from './config/environment.ts';
import Router from './router.ts';

class App extends EmberApp {
  modulePrefix = config.modulePrefix;
  modules = {
    './router': Router,
    ...import.meta.glob('./{routes,templates}/**/*.{ts,gts}', { eager: true }),
    ...import.meta.glob('./services/*.ts', { eager: true }),
  };
}

export function createSsrApp() {
  return App.create({ ...config.APP, autoboot: false });
}
```

### Client entry (`app/entry.ts`)

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox, cleanupSSRContent } from 'vite-ember-ssr/client';

installShoebox();
cleanupSSRContent();
Application.create(config.APP);
```

### Server handler

```js
import { renderEmberApp, assembleHTML } from 'vite-ember-ssr/server';

// In your request handler:
const { createSsrApp } = await vite.ssrLoadModule('/app/app-ssr.ts');
const template = await readFile('index.html', 'utf-8');
const html = await vite.transformIndexHtml(url, template);
const result = await renderEmberApp({ url, createApp: createSsrApp, shoebox: true });
const page = assembleHTML(html, result);
```

### SSR build config (`vite.config.ssr.mjs`)

```js
import { defineConfig } from 'vite';
import { ember } from '@embroider/vite';
import { emberSsr } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [ember(), ...emberSsr()],
  build: {
    ssr: 'app/app-ssr.ts',
    outDir: 'dist/server',
  },
});
```

### Vite SSR `noExternal`

Ember ecosystem packages must be processed by Vite, not resolved as native Node ESM:

```js
ssr: {
  noExternal: [
    /^@ember\//, /^@glimmer\//, /^@embroider\//,
    /^@warp-drive\//, /^ember-/, 'decorator-transforms',
  ],
}
```

## Development

```sh
pnpm install
pnpm dev          # Start dev server (Fastify + Vite middleware)
pnpm build        # Build library, client, and SSR bundles
pnpm demo         # Build everything and start production server
pnpm test         # Run SSR tests (vitest)
pnpm test:browser # Run browser tests (playwright)
pnpm test:all     # Run both
```
