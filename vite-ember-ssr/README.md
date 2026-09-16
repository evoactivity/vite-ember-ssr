# vite-ember-ssr

Vite plugin and runtime for server side rendering (SSR) and static site generation (SSG) of Ember.js applications. Renders Ember in Node.js using [HappyDOM](https://github.com/capricorn86/happy-dom), with no FastBoot and no VM sandbox.

> [!WARNING]
> **EXPERIMENTAL.** This project is in early development and targets **compatless** Ember apps only (no `@embroider/compat`, no `ember-cli-build.js`, no `classicEmberSupport()`). APIs will change. Do not use in production.

## Requirements

- An Ember app built with Embroider in compatless mode (no `@embroider/compat`, no `ember-cli-build.js`, no `classicEmberSupport()`).
- Vite 6+
- Node 22+

## Choose a mode

This library exposes two Vite plugins. They can be used independently or together.

- **`emberSsg`** prerenders a known list of routes to static HTML at build time. A single `vite build` produces deploy ready files. No server is required.
- **`emberSsr`** renders pages on every request from a Node.js server.
- **Combined** uses both plugins. Known routes are prerendered, everything else falls back to dynamic SSR.

|                | SSG (`emberSsg`)             | SSR (`emberSsr`)                                  |
| -------------- | ---------------------------- | ------------------------------------------------- |
| Rendering      | Build time                   | Request time                                      |
| Server         | Not required                 | Node.js server required                           |
| Build command  | `vite build`                 | `vite build` + `vite build --ssr`                 |
| Deploy         | Any static host              | Node.js hosting                                   |
| Dynamic routes | Must enumerate at build time | Any URL handled at runtime                        |
| Data freshness | Stale until next build       | Fresh on every request                            |
| Best for       | Marketing sites, docs, blogs | Apps with frequently changing or per request data |

If you are unsure, start with SSG. It has the fewest moving parts and the Quick Start below uses it.

## Install

```sh
pnpm add -D vite-ember-ssr
```

## Quick start (SSG)

This is the smallest end to end setup. It prerenders `index` and `about` to static HTML and ships them with the client bundle.

### `vite.config.mjs`

```js
import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsg } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    babel({ babelHelpers: 'runtime', extensions }),
    emberSsg({
      routes: ['index', 'about'],
    }),
  ],
});
```

### `index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <!-- VITE_EMBER_SSR_HEAD -->
  </head>
  <body>
    <!-- VITE_EMBER_SSR_BODY -->
    <script type="module" src="/app/entry.ts"></script>
  </body>
</html>
```

### `app/app-ssr.ts`

```ts
import EmberApp from 'ember-strict-application-resolver';
import config from './config/environment.ts';
import Router from './router.ts';

// Re-exporting `settled` lets the renderer await Ember's run loop, pending
// timers, and any registered test-waiters before capturing the DOM. See
// the Concepts section below for details.
export { settled } from '@ember/test-helpers';

class App extends EmberApp {
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

### `app/entry.ts`

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { bootRehydrated } from 'vite-ember-ssr/client';

bootRehydrated(Application, config);
```

### `app/templates/application.gts`

```gts
import { LinkTo } from '@ember/routing';

<template>
  <nav>
    <LinkTo @route="index">Home</LinkTo>
    <LinkTo @route="about">About</LinkTo>
  </nav>

  {{outlet}}
</template>
```

### Build

```sh
vite build
```

Output:

```
dist/
  index.html         prerendered index route
  about/index.html   prerendered about route
  assets/
    main-abc123.js
    main-abc123.css
```

Serve `dist/` from any static host. That is the whole pipeline.

## Concepts

The Quick Start uses four building blocks. Every mode in this library uses the same four. SSR and Combined sections below only show what differs from the Quick Start.

### How rendering works

- A per request HappyDOM `Window` provides a browser like environment in Node. Ember globals are swapped in for the duration of one render.
- `Application.visit(url, { _renderMode: 'serialize' })` drives the render cycle on the server, the same way FastBoot does. `_renderMode: 'serialize'` annotates the DOM with Glimmer rehydration markers.
- After Ember settles, the resulting `<head>` and `<body>` content are extracted and inserted into your HTML template at the SSR markers.
- On the client, `bootRehydrated` calls `app.visit(url, { _renderMode: 'rehydrate' })` and Glimmer attaches to the existing DOM in place. See [Client boot](#client-boot).

### SSR markers in `index.html`

Two HTML comments tell the renderer where to inject content:

```html
<!-- VITE_EMBER_SSR_HEAD -->
<!-- VITE_EMBER_SSR_BODY -->
```

The first is replaced with anything Ember rendered into `<head>` (page title, meta tags, etc.). The second is replaced with the rendered application body.

### SSR entry (`app/app-ssr.ts`)

This module exports a factory the renderer calls once per worker. The factory must:

- Create an `EmberApp` subclass that registers your routes, templates, and services via `import.meta.glob({ eager: true })`.
- Pass `autoboot: false` so the app does not try to boot itself when the module loads.

The exported function (named `createSsrApp` by convention) is wrapped in an async function inside the renderer that imports the SSR bundle on demand.

#### Settling

If your `app-ssr.ts` re-exports `settled` from `@ember/test-helpers`, the renderer awaits it after every `app.visit()`:

```ts
export { settled } from '@ember/test-helpers';
```

`settled()` waits for Ember's run loop, pending Backburner timers, in-flight AJAX, route transitions, and any registered `@ember/test-waiters` (used by WarpDrive, ember-concurrency, etc.) to drain before the DOM is captured.

Without this export, the renderer falls back to a single microtask drain (`await new Promise(r => setTimeout(r, 0))`), which catches synchronous reactivity but misses async work scheduled outside the microtask queue.

The renderer races `settled()` against a configurable timeout (default 10s). If exceeded, a warning is logged and the DOM is captured anyway. See [`app.renderRoute`](#vite-ember-ssrserver) for `settledTimeout`.

### Client entry

The client entry calls `bootRehydrated(Application, config)`. This helper looks at `window.__vite_ember_ssr_rehydrate__` (set by the server) and either:

- Boots with `autoboot: false` and calls `app.visit(url, { _renderMode: 'rehydrate' })` so Glimmer attaches to the server rendered DOM, or
- Falls back to `Application.create(config.APP)` for pages that were not server rendered.

See [Client boot](#client-boot) for the full helper behaviour.

## SSR mode

Use SSR when you need fresh data on every request, or when routes cannot be enumerated at build time.

### Vite config

Replace `emberSsg` with `emberSsr`:

```js
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

### Build

SSR needs both a client build and a server build:

```sh
vite build                      # client → dist/client
vite build --ssr app/app-ssr.ts # server → dist/server
```

### Server integration

Create the worker pool once at startup. Call `renderRoute` from your catch all handler.

```js
import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';

// Production: tinypool worker pool, SSR bundle loaded once per worker
const emberApp = await createEmberApp('./dist/server/app-ssr.mjs');

// Development: in process render via Vite's ssrLoadModule
// const vite = await createServer({ ... });
// const emberApp = await createEmberApp('app/app-ssr.ts', {
//   dev: { ssrLoadModule: vite.ssrLoadModule.bind(vite) },
// });

const rendered = await emberApp.renderRoute(request.url);
const html = assembleHTML(template, rendered);
// rendered.statusCode and rendered.error are also available

// Shutdown:
await emberApp.destroy();
```

See [examples/fastify.md](https://github.com/evoactivity/vite-ember-ssr/blob/main/examples/fastify.md) for a complete Fastify server with both dev and prod modes.

## SSG mode

Quick Start covers the basic case. This section documents everything else.

### Route format

`routes` entries are URL paths without a leading slash. The renderer visits each URL and writes the result to disk.

- `'index'` is special cased and produces `dist/index.html`.
- Anything else produces `<path>/index.html`, so `'about'` becomes `dist/about/index.html` and `'pokemon/charmander'` becomes `dist/pokemon/charmander/index.html`.

### What `vite build` does

A single `vite build`:

1. Builds the client assets (JS, CSS, HTML shell).
2. Runs a second SSR build internally to produce a temporary server bundle.
3. Renders each route in `routes` using HappyDOM.
4. Writes the resulting HTML files into the output directory.
5. Cleans up the temporary bundle.

### Options

See the [API reference](#emberssgoptions) for the full options table.

### Deploy

Serve `dist/` from any static host. No Node.js runtime required.

```sh
npx http-server dist
```

## Combined SSR + SSG

Use both plugins together to prerender known static routes while keeping dynamic SSR for everything else. Prerendered routes are served as static files. Other routes render on demand.

When `emberSsg` detects that `emberSsr` is also installed, it changes its output strategy:

1. Copies `dist/client/index.html` to `dist/client/_template.html` (preserving the SSR markers).
2. Prerenders each route into `dist/client/`.
3. If `'index'` is in your routes list, `index.html` is overwritten with the prerendered index route.

The server reads `_template.html` as the SSR template for dynamic rendering.

### Vite config

```js
import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsr, emberSsg } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    babel({ babelHelpers: 'runtime', extensions }),
    emberSsr(),
    emberSsg({
      routes: ['index', 'about', 'contact'],
    }),
  ],
});
```

### Build

```sh
vite build                      # client + SSG prerender → dist/client
vite build --ssr app/app-ssr.ts # server bundle → dist/server
```

Output structure:

```
dist/
  client/
    _template.html      original index.html with SSR markers (used for dynamic SSR)
    index.html          prerendered
    about/index.html    prerendered
    contact/index.html  prerendered
    assets/
      main-abc123.js
      main-abc123.css
  server/
    app-ssr.mjs         SSR server bundle
    package.json
```

### Server integration

The server checks for a prerendered file first, then falls back to dynamic SSR using `_template.html`.

```js
import { readFile, access } from 'node:fs/promises';
import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const ssrTemplate = await readFile('dist/client/_template.html', 'utf-8');
const emberApp = await createEmberApp('./dist/server/app-ssr.mjs');

app.get('*', async (request, reply) => {
  const url = request.url;

  // 1. Try a prerendered file
  const staticPath = resolveStaticFile(clientDir, url);
  try {
    await access(staticPath);
    const html = await readFile(staticPath, 'utf-8');
    return reply.code(200).type('text/html').send(html);
  } catch {
    // No prerendered file, fall through
  }

  // 2. Fall back to dynamic SSR
  const rendered = await emberApp.renderRoute(url, { shoebox: true });
  const html = assembleHTML(ssrTemplate, rendered);

  return reply.code(rendered.statusCode).type('text/html').send(html);
});
```

See [examples/fastify-combined.md](https://github.com/evoactivity/vite-ember-ssr/blob/main/examples/fastify-combined.md) for a complete example.

## Client boot

The library always renders pages with Glimmer rehydration markers. On the client, `bootRehydrated` calls `app.visit(url, { _renderMode: 'rehydrate' })` and Glimmer attaches to the server rendered DOM in place. There is no flash, no DOM tear down, and no `cleanupSSRContent` step.

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { bootRehydrated } from 'vite-ember-ssr/client';

bootRehydrated(Application, config);
```

The server injects a `window.__vite_ember_ssr_rehydrate__` flag on every server rendered page. `bootRehydrated` checks for it and:

- If present, creates the application with `autoboot: false` and calls `app.visit(url, { _renderMode: 'rehydrate' })`. The visit URL is derived from `window.location.pathname + search` with `config.rootURL` stripped.
- If absent, calls `Application.create(config.APP)` for a normal boot. This matters for SSG apps where the user navigates to a route that was never prerendered, or for dev pages hit without an SSR middleware.

If you need to branch on rehydrate vs. plain boot yourself, `shouldRehydrate()` is exported and returns the same boolean.

> **Note:** `_renderMode` is a private Ember API (underscore prefix) that has existed since Ember 2.x for FastBoot rehydration. It is stable in practice but not part of the public API.

## Advanced topics

### Shoebox

The shoebox captures `fetch` responses made during SSR or SSG and serializes them into `<script>` tags in the rendered HTML. On the client, `installShoebox()` intercepts `fetch` and replays the cached responses, avoiding duplicate API requests on first load.

Shoebox is opt in. Enable it only when your routes make `fetch` calls during server rendering that the client would otherwise repeat.

Server (SSR):

```js
const rendered = await emberApp.renderRoute(url, { shoebox: true });
```

Server (SSG):

```js
emberSsg({ routes: ['index', 'about'], shoebox: true });
```

Client, before `Application.create`:

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox } from 'vite-ember-ssr/client';

installShoebox();
Application.create(config.APP);
```

#### How it works

1. During SSR or SSG, the server intercepts `fetch()` calls and records the responses.
2. Responses are serialized as `<script type="application/json" class="shoebox">` tags.
3. On the client, `installShoebox()` reads those tags, wraps `window.fetch`, and serves cached responses for matching URLs.
4. Once all cached entries are consumed, the original `fetch` is restored automatically.

#### When to use it

- Routes that fetch data in `model()` hooks.
- Any case where the client would re fetch the same data immediately on boot.

#### When to skip it

- Static pages with no server side data fetching.
- Apps that intentionally re fetch for freshness.

#### Caveats

- Embedding large API responses increases HTML payload size.
- Never serialize sensitive or user specific data into the shoebox. The HTML is cached and served to all users.

### Lazy routes (`@embroider/router`)

Both SSR and SSG support `@embroider/router`'s lazy loaded route bundles (`window._embroiderRouteBundles_`). No additional configuration is required.

The CSS of a lazy route is linked in the `<head>` of every server rendered page that loads it, so the page does not flash unstyled before the route's JS arrives. The client build writes the `css-manifest.json` this needs. Pass it to `renderRoute` on an SSR server, see [`loadCssManifest`](#vite-ember-ssrserver). SSG picks it up on its own.

This works with any file layout. Route files can live anywhere, and `modules` and `_embroiderRouteBundles_` can be assembled any way the app likes.

### SSR bundling (`ssr.noExternal`)

Both plugins set `ssr.noExternal: [/./]`, which tells Vite to bundle every dependency into the SSR build instead of leaving them as runtime `require`/`import` calls.

This is necessary because Ember's virtual packages (`@glimmer/tracking`, `@ember/*`, etc.) are provided by `ember-source` and are not real packages on disk. If Vite externalises a dependency that imports one of them, Node's runtime resolution fails under pnpm's strict `node_modules` layout. Bundling everything also keeps CJS/UMD packages going through Vite's transform pipeline, where the plugin's CJS shim can wrap them.

There is no real downside to bundling on the server. SSR builds are not shipped to browsers, so bundle size is not a constraint, and a single self contained SSR bundle simplifies deployment.

You should not need to touch this. If you do need to add to it, Vite deep merges arrays so your entries are concatenated with the built in pattern.

## API reference

### `vite-ember-ssr/vite-plugin`

```js
import { emberSsr, emberSsg } from 'vite-ember-ssr/vite-plugin';
```

#### `emberSsr(options?)`

Vite plugin for runtime SSR. Configures `ssr.noExternal`, build output directories (`dist/client`, `dist/server`), SSR build defaults (`target: 'node22'`, `sourcemap: true`, `minify: false`), and writes `{"type": "module"}` to the SSR output directory.

| Option         | Type     | Default         | Description             |
| -------------- | -------- | --------------- | ----------------------- |
| `clientOutDir` | `string` | `'dist/client'` | Client build output dir |
| `serverOutDir` | `string` | `'dist/server'` | SSR bundle output dir   |

#### `emberSsg(options)`

Vite plugin for static site generation.

| Option     | Type       | Default            | Description                                                                             |
| ---------- | ---------- | ------------------ | --------------------------------------------------------------------------------------- |
| `routes`   | `string[]` | (required)         | URL paths to prerender. `'index'` is special cased, see [Route format](#route-format)   |
| `ssrEntry` | `string`   | `'app/app-ssr.ts'` | Path to the SSR entry module                                                            |
| `shoebox`  | `boolean`  | `false`            | Serialize captured fetch responses into the HTML, see [Shoebox](#shoebox)               |
| `outDir`   | `string`   | `'dist'`           | Output directory. Ignored when combined with `emberSsr` (output goes to `clientOutDir`) |

### `vite-ember-ssr/server`

```js
import {
  createEmberApp,
  assembleHTML,
  loadCssManifest,
  hasSSRMarkers,
} from 'vite-ember-ssr/server';
```

- **`createEmberApp(ssrBundlePath, options?)`** creates a long lived tinypool worker pool. Each worker imports the SSR bundle once at startup. Returns an `EmberApp`. Options: `{ workers?: number, recycleWorkerInterval?: number, isolateWorkers?: boolean, dev?: { ssrLoadModule } }`.
- **`app.renderRoute(url, options?)`** renders a URL path. Returns `{ head, body, statusCode, error }`. Options: `{ shoebox?, cssManifest?, settledTimeout? }`. `settledTimeout` (default `10000`) bounds how long the renderer waits for the SSR bundle's exported `settled()` to resolve, see [Settling](#settling).
- **`app.destroy()`** shuts down the worker pool.
- **`assembleHTML(template, renderResult)`** inserts rendered fragments into the template at the `<!-- VITE_EMBER_SSR_HEAD -->` and `<!-- VITE_EMBER_SSR_BODY -->` markers.
- **`loadCssManifest(clientDir)`** loads the CSS manifest from the client build output. Returns `undefined` if not present. Used with lazy routes, see [Lazy routes](#lazy-routes-embroiderrouter).
- **`hasSSRMarkers(html)`** returns `{ head: boolean, body: boolean }` indicating which markers are present.

### `vite-ember-ssr/client`

```js
import {
  bootRehydrated,
  shouldRehydrate,
  installShoebox,
  cleanupShoebox,
} from 'vite-ember-ssr/client';
```

- **`bootRehydrated(Application, config)`** boots the client Ember app, rehydrating the server rendered DOM when present. Falls back to a normal `Application.create(config.APP)` when the page was not server rendered. See [Client boot](#client-boot).
- **`shouldRehydrate()`** returns `true` if the current page was rendered with rehydration markers (the server injected `window.__vite_ember_ssr_rehydrate__`). Useful when you need to branch on rehydrate vs. plain boot yourself.
- **`installShoebox()`** replays server captured fetch responses. Auto restores `fetch` once all entries are consumed. Call in `entry.ts` before booting.
- **`cleanupShoebox()`** manually restores the original `fetch`.

## Monorepo development

This repo contains the library and a set of test apps that exercise it.

| Path                                       | Description                                                |
| ------------------------------------------ | ---------------------------------------------------------- |
| `vite-ember-ssr/`                          | Core library and test suites                               |
| `test-apps/test-app/`                      | Ember test app (SSR)                                       |
| `test-apps/test-app-ssg/`                  | Ember test app (SSG)                                       |
| `test-apps/test-app-combined/`             | Ember test app (SSR + SSG)                                 |
| `test-apps/test-app-lazy-ssr/`             | Ember test app (SSR + lazy routes)                         |
| `test-apps/test-app-lazy-ssg/`             | Ember test app (SSG + lazy routes)                         |
| `test-apps/test-app-routes-layout-ssg/`    | Ember test app (SSG + lazy routes in `app/routes/<name>/`) |
| `test-apps/test-app-monorepo-ssr/`         | Ember test app consuming a monorepo lib                    |
| `test-apps/test-app-monorepo-ssg/`         | Same, for SSG                                              |
| `test-apps/test-app-ssr-loading-substate/` | Loading substate behaviour (SSR)                           |
| `test-apps/test-app-ssg-loading-substate/` | Loading substate behaviour (SSG)                           |
| `test-apps/monorepo-lib/`                  | Shared library used by the monorepo apps                   |
| `test-apps/test-server/`                   | Fastify SSR server                                         |

Top level scripts:

```sh
pnpm install
pnpm dev           # dev server (Fastify + Vite middleware)
pnpm build         # build library + test app
pnpm demo          # build everything, start production server
pnpm test          # vitest SSR tests
pnpm test:browser  # playwright browser tests
pnpm test:all      # both
pnpm clean         # remove dist directories
pnpm format        # prettier --write .
```

## Performance

- Server startup: ~1s (no ember-cli build step)
- First SSR render: ~3s (cold module loading)
- Warm SSR render: ~24ms

## License

MIT
