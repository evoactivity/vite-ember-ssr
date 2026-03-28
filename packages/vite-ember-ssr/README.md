# vite-ember-ssr

> [!WARNING]
> **EXPERIMENTAL** — This project is in early development and targets **compatless** Ember apps only (no `@embroider/compat`, no `ember-cli-build.js`, no `classicEmberSupport()`). APIs will change. Do not use in production.

Vite plugin and SSR runtime for Ember.js applications. Uses [HappyDOM](https://github.com/capricorn86/happy-dom) for server-side rendering — no FastBoot, no VM sandbox.

## Quickstart (copy-paste)

1. Install the package and required peers:

```sh
pnpm add -D vite-ember-ssr @embroider/vite ember-strict-application-resolver
```

2. Add the Vite plugin to `vite.config.mjs` (see full example below):

3. Add SSR markers to `index.html`:

```html
<!-- VITE_EMBER_SSR_HEAD -->
<!-- VITE_EMBER_SSR_BODY -->
```

4. Create `app/app-ssr.ts` (export a `createSsrApp` factory) and `app/entry.ts` (client boot that calls `installShoebox()` and `cleanupSSRContent()`).

5. Build and run:

```sh
vite build                      # client → dist/client
vite build --ssr app/app-ssr.ts # server → dist/server
# use your server (see examples/fastify.md)
```

## Architecture

- **HappyDOM Window** provides a full per-request browser-like environment. Ember runs directly in the Node.js process with globals swapped per request.
- **`Application.visit(url)`** drives the entire render cycle server-side.
- **No hydration yet** — the client boots normally and replaces SSR content. SSR provides the initial visual while JS loads.
- **Shoebox** — fetch responses captured during SSR are serialized into the HTML and replayed on the client to avoid duplicate API requests.

## Requirements

- Ember app built with Embroider in "compatless" mode (no `@embroider/compat`, no `ember-cli-build.js`, and no `classicEmberSupport()`).
  - If you're unsure what this means: compatless apps rely on the new Embroider build pipeline. See Embroider docs for details and migration guidance.
- `@embroider/vite` (use the `ember()` plugin)
- `ember-strict-application-resolver` instead of `ember-resolver` (install with `pnpm add -D ember-strict-application-resolver`) — this library provides an ES-module friendly application resolver used by the SSR entry.
- Your app's `config/environment` must be a direct ES module import (i.e. `import config from './config/environment.ts'`). Do not rely on `<meta>` config injection or `@embroider/config-meta-loader`.
- Vite 6+
- Node 22+

## Installation

```sh
pnpm add -D vite-ember-ssr
```

## Setup

### 1. Vite config

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsr } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    babel({ babelHelpers: 'runtime', extensions }),
    emberSsr(),
  ],
});
```

### 2. HTML template

Add SSR markers to `index.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <!-- VITE_EMBER_SSR_HEAD -->
  </head>
  <body>
    <!-- VITE_EMBER_SSR_BODY -->
    <script type="module" src="/app/entry.ts"></script>
  </body>
</html>
```

### 3. SSR entry (`app/app-ssr.ts`)

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

Notes:
- Place this file in your application package at `app/app-ssr.ts` (the SSR build references that path in examples).
- `autoboot: false` prevents the Ember application from attempting to boot itself in the server environment; instead we call `Application.visit(url)` to drive rendering.
- The `modules` map uses `import.meta.glob(..., { eager: true })` to provide the resolver with preloaded route/template/service modules — this mirrors how Embroider/Ember apps load modules at runtime in a static environment.
- Keep the glob patterns broad enough to include your `routes`, `templates`, and `services` so the resolver can find everything the app needs during SSR.
```

### 4. Client entry (`app/entry.ts`)

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox, cleanupSSRContent } from 'vite-ember-ssr/client';

installShoebox();
cleanupSSRContent();
Application.create(config.APP);
```

### 5. Build

```sh
vite build                      # client → dist/client
vite build --ssr app/app-ssr.ts # server → dist/server
```

### 6. Server

Wire up `render()` in your server's catch-all route. See [examples/fastify.md](examples/fastify.md) for a complete Fastify example with dev and production modes.

Shoebox (fetch replay):

- Pass `shoebox: true` to `render()` to capture `fetch` responses during SSR and serialize them into the rendered HTML. On the client call `installShoebox()` before boot to replay those responses and avoid duplicate requests.
- Default: shoebox is opt-in. Use it when your app makes server-side fetch calls that the client would otherwise repeat on first load.
- Caveats: embedding large API responses increases HTML size; do not serialize sensitive data into the shoebox.

## API

### `vite-ember-ssr/vite-plugin`

```js
import { emberSsr } from 'vite-ember-ssr/vite-plugin';
```

Single Vite plugin. Handles all SSR-related configuration:

- `ssr.noExternal` for Ember ecosystem packages
- Build output directories (`dist/client` and `dist/server`)
- SSR build defaults (`target: 'node22'`, `sourcemap: true`, `minify: false`)
- Writes `{"type": "module"}` to SSR output directory

Options:

```js
emberSsr({
  clientOutDir: 'dist/client',          // default
  serverOutDir: 'dist/server',          // default
  additionalNoExternal: ['my-addon'],   // extend built-in patterns
})
```

### `vite-ember-ssr/server`

```js
import { render } from 'vite-ember-ssr/server';
```

- **`render({ url, template, createApp, shoebox? })`** — render an Ember app and assemble the final HTML. Returns `{ html, statusCode, error }`.

Lower-level functions are also exported for advanced use:

- **`renderEmberApp({ url, createApp, shoebox? })`** — render only, returns `{ head, body, statusCode, error }`.
- **`assembleHTML(template, renderResult)`** — replace SSR markers in the HTML template.

### `vite-ember-ssr/client`

```js
import { installShoebox, cleanupSSRContent, cleanupShoebox } from 'vite-ember-ssr/client';
```

- **`installShoebox()`** — replay server-captured fetch responses, auto-restores `fetch` when all entries consumed.
- **`cleanupSSRContent()`** — remove SSR-rendered DOM nodes before client Ember boots.
- **`cleanupShoebox()`** — manually restore original `fetch`.

## Monorepo development

This repo contains three packages:

| Package | Description |
|---|---|
| `packages/vite-ember-ssr` | Core library |
| `packages/test-app` | Ember test app |
| `packages/test-server` | Fastify SSR server + test suites |

```sh
pnpm install
pnpm dev          # dev server (Fastify + Vite middleware)
pnpm build        # build library + test app
pnpm demo         # build everything, start production server
pnpm test         # vitest SSR tests
pnpm test:browser # playwright browser tests
pnpm test:all     # both
```

## Performance

- Server startup: ~1s (no ember-cli build step)
- First SSR render: ~3s (cold module loading)
- Warm SSR render: ~24ms

## License

ISC
