# vite-ember-ssr

> [!WARNING]
> **EXPERIMENTAL** — This project is in early development and targets **compatless** Ember apps only (no `@embroider/compat`, no `ember-cli-build.js`, no `classicEmberSupport()`). APIs will change. Do not use in production.

Vite plugin and SSR/SSG runtime for Ember.js applications. Uses [HappyDOM](https://github.com/capricorn86/happy-dom) for server-side rendering — no FastBoot, no VM sandbox.

Two modes are supported:

- **SSR** (`emberSsr`) — server renders pages on each request at runtime. Requires a Node.js server.
- **SSG** (`emberSsg`) — prerenders specified routes to static HTML files at build time. A single `vite build` produces deploy-ready files. No server required.

Both plugins can be used together in the same Vite config for a **combined SSR + SSG** setup — prerender known static routes at build time while falling back to dynamic SSR for everything else.

## Architecture

- **HappyDOM Window** provides a full per-request browser-like environment. Ember runs directly in the Node.js process with globals swapped per request.
- **`Application.visit(url)`** drives the entire render cycle server-side.
- **Two client boot modes** — cleanup mode (default) removes SSR content when Ember boots; rehydrate mode lets Glimmer reuse the server-rendered DOM. See [Client Boot Modes](#client-boot-modes) below.
- **Shoebox** — fetch responses captured during SSR/SSG are serialized into the HTML and replayed on the client to avoid duplicate API requests.

## Requirements

- Ember app built with Embroider in "compatless" mode (no `@embroider/compat`, no `ember-cli-build.js`, and no `classicEmberSupport()`).
- Your app's `config/environment` must be a direct ES module import (i.e. `import config from './config/environment.ts'`). Do not rely on `<meta>` config injection or `@embroider/config-meta-loader`.
- Vite 6+
- Node 22+

## Installation

```sh
pnpm add -D vite-ember-ssr
```

## Setup

### SSR (Server-Side Rendering)

Use `emberSsr` when you have a Node.js server that renders pages on each request.

#### 1. Vite config

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsr } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
    emberSsr(),
  ],
});
```

#### 2. HTML template

Add SSR markers to `index.html`:

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

#### 3. SSR entry (`app/app-ssr.ts`)

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

#### 4. Client entry (`app/entry.ts`)

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox } from 'vite-ember-ssr/client';

installShoebox();
Application.create(config.APP);
```

#### 5. Application template (`app/templates/application.gts`)

Call `cleanupSSRContent` from the application template so the SSR-rendered DOM is removed at the moment Ember renders, avoiding a flash of no content:

```gts
import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import { cleanupSSRContent } from 'vite-ember-ssr/client';

<template>
  {{pageTitle "MyApp"}}
  {{cleanupSSRContent}}

  <nav>
    <LinkTo @route="index">Home</LinkTo>
    <LinkTo @route="about">About</LinkTo>
  </nav>

  {{outlet}}
</template>
```

#### 5. Build

```sh
vite build                      # client → dist/client
vite build --ssr app/app-ssr.ts # server → dist/server
```

#### 6. Server

Wire up `render()` in your server's catch-all route. See [examples/fastify.md](https://github.com/evoactivity/vite-ember-ssr/blob/main/examples/fastify.md) for a complete Fastify example with dev and production modes.

Shoebox (fetch replay):

- Pass `shoebox: true` to `render()` to capture `fetch` responses during SSR and serialize them into the rendered HTML. On the client call `installShoebox()` before boot to replay those responses and avoid duplicate requests.
- Default: shoebox is opt-in. Use it when your app makes server-side fetch calls that the client would otherwise repeat on first load.
- Caveats: embedding large API responses increases HTML size; do not serialize sensitive data into the shoebox.

### SSG (Static Site Generation)

Use `emberSsg` when you want to prerender routes to static HTML files at build time. No server required — the output can be deployed to any static hosting (Netlify, Vercel, GitHub Pages, S3, etc.).

A single `vite build` command:

1. Builds the client assets (JS, CSS, HTML shell)
2. Runs a second SSR build internally to produce a temporary server bundle
3. Renders each specified route using HappyDOM
4. Writes the resulting HTML files into the output directory
5. Cleans up the temporary bundle

#### 1. Vite config

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsg } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    babel({ babelHelpers: 'runtime', extensions }),
    emberSsg({
      routes: ['index', 'about', 'contact', 'pokemon/charmander'],
    }),
  ],
});
```

#### 2. HTML template

Same as SSR — add markers to `index.html`:

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

#### 3. SSR entry (`app/app-ssr.ts`)

Same as SSR — export a `createSsrApp` factory function. See the SSR section above.

#### 4. Client entry and application template

Same as SSR — see [Client Boot Modes](#client-boot-modes) below for the two options:

- **Cleanup mode** (default): call `installShoebox()` in `entry.ts` and `{{cleanupSSRContent}}` in the application template.
- **Rehydrate mode** (`rehydrate: true` in `emberSsg()`): call `installShoebox()` in `entry.ts`, boot with `autoboot: false` and `app.visit()` with `_renderMode: 'rehydrate'`. No `cleanupSSRContent` needed.

#### 5. Build

```sh
vite build
```

That's it. The output directory (default: `dist/`) contains deploy-ready static files:

```
dist/
  index.html              ← prerendered index route
  about/index.html        ← prerendered about route
  contact/index.html      ← prerendered contact route
  pokemon/
    charmander/index.html ← prerendered nested route
  assets/
    main-abc123.js        ← client JS bundle
    main-abc123.css       ← client CSS bundle
```

#### 6. Deploy

Serve the `dist/` directory with any static file server. No Node.js runtime needed.

```sh
# Local preview
npx http-server dist

# Or deploy to any static host
```

#### Route format

Routes are specified as Ember route names (without leading slashes):

- `'index'` → `dist/index.html`
- `'about'` → `dist/about/index.html`
- `'pokemon'` → `dist/pokemon/index.html`
- `'pokemon/charmander'` → `dist/pokemon/charmander/index.html`

#### Options

```js
emberSsg({
  // Required: routes to prerender
  routes: ['index', 'about', 'contact'],

  // SSR entry module (default: 'app/app-ssr.ts')
  ssrEntry: 'app/app-ssr.ts',

  // Enable shoebox fetch replay (default: true)
  // When true, fetch responses from model hooks are serialized into the HTML
  // so the client doesn't re-fetch on boot
  shoebox: true,

  // Enable Glimmer rehydration (default: false)
  // When true, prerendered HTML includes Glimmer serialization markers.
  // The client boots with app.visit(url, { _renderMode: 'rehydrate' })
  // to reuse the static DOM instead of replacing it.
  rehydrate: false,

  // Output directory (default: 'dist')
  outDir: 'dist',

  // Additional packages for ssr.noExternal
  additionalNoExternal: ['my-addon'],
});
```

#### SSG vs SSR: when to use which

|                    | SSG (`emberSsg`)             | SSR (`emberSsr`)                                                                |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------- |
| **Rendering**      | Build time                   | Request time                                                                    |
| **Server**         | Not required                 | Node.js server required                                                         |
| **Build command**  | `vite build`                 | `vite build` + `vite build --ssr`                                               |
| **Deploy**         | Any static host              | Node.js hosting                                                                 |
| **Dynamic routes** | Must enumerate at build time | Any URL handled at runtime                                                      |
| **Data freshness** | Stale until next build       | Fresh on every request                                                          |
| **Best for**       | Marketing sites, docs, blogs | Apps with frequently changing content, dynamic per-request data, real-time data |

### Combined SSR + SSG

Use both plugins together to prerender known static routes at build time while keeping dynamic SSR for everything else. The SSG plugin automatically detects `emberSsr` and defers to its output directory — prerendered files land in `dist/client/` alongside client assets.

#### How it works

During `vite build`, `emberSsg` detects that `emberSsr` is present and:

1. Copies `dist/client/index.html` to `dist/client/_template.html` (preserving the SSR markers)
2. Prerenders each route and writes the resulting HTML files into `dist/client/`
3. If `'index'` is in your routes list, `index.html` is overwritten with the prerendered index route

Your production server reads `_template.html` as the SSR template for dynamic rendering, while prerendered routes are served directly as static files.

#### 1. Vite config

```js
// vite.config.mjs
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

#### 2. Build

```sh
vite build                      # client + SSG prerender → dist/client
vite build --ssr app/app-ssr.ts # server bundle → dist/server
```

Output structure:

```
dist/
  client/
    _template.html            ← original index.html with SSR markers (for dynamic SSR)
    index.html                ← prerendered
    about/index.html          ← prerendered
    contact/index.html        ← prerendered
    assets/
      main-abc123.js
      main-abc123.css
  server/
    app-ssr.mjs               ← SSR server bundle
    package.json
```

#### 3. Server

Your server checks for a prerendered static file first, then falls back to dynamic SSR using `_template.html`. See [examples/fastify-combined.md](https://github.com/evoactivity/vite-ember-ssr/blob/main/examples/fastify-combined.md) for a complete Fastify example.

```js
import { readFile, access } from 'node:fs/promises';
import { render } from 'vite-ember-ssr/server';

// Load _template.html once at startup — it contains the SSR markers
const ssrTemplate = await readFile('dist/client/_template.html', 'utf-8');

// In your catch-all route handler:
app.get('*', async (request, reply) => {
  const url = request.url;

  // 1. Try serving a prerendered file
  const staticPath = resolveStaticFile(clientDir, url);
  try {
    await access(staticPath);
    const html = await readFile(staticPath, 'utf-8');
    return reply.code(200).type('text/html').send(html);
  } catch {
    // No prerendered file — fall through
  }

  // 2. Fall back to dynamic SSR
  const { html, statusCode } = await render({
    url,
    template: ssrTemplate,
    createApp: createSsrApp,
    shoebox: true,
  });

  return reply.code(statusCode).type('text/html').send(html);
});
```

Prerendered routes are served instantly as static files (no Node.js rendering cost). All other routes are rendered on-demand by the SSR server.

### Client Boot Modes

There are two ways the client Ember app can take over from the server-rendered HTML. The server and client must agree on the mode.

#### Cleanup mode (default)

The server wraps rendered content in boundary markers. On boot, `cleanupSSRContent()` removes those markers and the SSR content, then Ember renders fresh into the empty `<body>`. This is the simplest approach — SSR provides a visual shell while JS loads, then Ember replaces it.

**Server:** use default options (no `rehydrate` flag)

```js
const { html } = await render({
  url,
  template,
  createApp: createSsrApp,
  shoebox: true,
});
```

**Client entry (`app/entry.ts`):**

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox } from 'vite-ember-ssr/client';

installShoebox();
Application.create(config.APP);
```

**Application template (`app/templates/application.gts`):**

```gts
import { cleanupSSRContent } from 'vite-ember-ssr/client';

<template>
  {{cleanupSSRContent}}
  {{outlet}}
</template>
```

Calling `cleanupSSRContent` from the template (rather than from `entry.ts` before boot) ensures the SSR content is removed at the moment Ember renders, avoiding a flash of no content.

#### Rehydrate mode

The server renders with `_renderMode: 'serialize'`, which annotates the DOM with Glimmer-specific markers. On boot, the client calls `app.visit()` with `_renderMode: 'rehydrate'`, and Glimmer walks the existing DOM and attaches its tracking/update machinery without tearing it down. This avoids the visual flash entirely — the server-rendered DOM becomes the live Ember app.

**Server:** pass `rehydrate: true`

```js
const { html } = await render({
  url,
  template,
  createApp: createSsrApp,
  shoebox: true,
  rehydrate: true,
});
```

**Client entry (`app/entry.ts`):**

```ts
import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox } from 'vite-ember-ssr/client';

installShoebox();

const app = Application.create({ ...config.APP, autoboot: false });
app.visit(window.location.pathname + window.location.search, {
  _renderMode: 'rehydrate',
});
```

No `cleanupSSRContent` is needed in rehydrate mode — Glimmer reuses the DOM as-is. No boundary markers are emitted by the server.

> **Note:** `_renderMode` is a private Ember API (underscore prefix) that has existed since Ember 2.x for FastBoot rehydration. It is stable in practice but not part of the public API.

## API

### `vite-ember-ssr/vite-plugin`

```js
import { emberSsr, emberSsg } from 'vite-ember-ssr/vite-plugin';
```

#### `emberSsr(options?)`

Vite plugin for runtime SSR. Handles all SSR-related configuration:

- `ssr.noExternal` for Ember ecosystem packages
- Build output directories (`dist/client` and `dist/server`)
- SSR build defaults (`target: 'node22'`, `sourcemap: true`, `minify: false`)
- Writes `{"type": "module"}` to SSR output directory

Options:

```js
emberSsr({
  clientOutDir: 'dist/client', // default
  serverOutDir: 'dist/server', // default
  additionalNoExternal: ['my-addon'], // extend built-in patterns
});
```

#### `emberSsg(options)`

Vite plugin for static site generation. Prerenders specified routes to HTML files at build time with a single `vite build`. See the [SSG setup section](#ssg-static-site-generation) for usage.

Options:

```js
emberSsg({
  routes: ['index', 'about'], // required: routes to prerender
  ssrEntry: 'app/app-ssr.ts', // default: SSR entry module path
  shoebox: true, // default: serialize fetch responses into HTML
  rehydrate: false, // default: use Glimmer rehydration instead of cleanup mode
  outDir: 'dist', // default: output directory (ignored when combined with emberSsr)
  additionalNoExternal: [], // extend built-in ssr.noExternal patterns
});
```

### `vite-ember-ssr/server`

```js
import { render } from 'vite-ember-ssr/server';
```

- **`render({ url, template, createApp, shoebox?, rehydrate? })`** — render an Ember app and assemble the final HTML. Returns `{ html, statusCode, error }`.

Lower-level functions are also exported for advanced use:

- **`renderEmberApp({ url, createApp, shoebox?, rehydrate? })`** — render only, returns `{ head, body, statusCode, error }`.
- **`assembleHTML(template, renderResult)`** — replace SSR markers in the HTML template.

### `vite-ember-ssr/client`

```js
import {
  installShoebox,
  cleanupSSRContent,
  cleanupShoebox,
  isSSRRendered,
} from 'vite-ember-ssr/client';
```

- **`installShoebox()`** — replay server-captured fetch responses, auto-restores `fetch` when all entries consumed. Call in `entry.ts` before Ember boots.
- **`cleanupSSRContent()`** — remove SSR-rendered DOM nodes. Call from the application template as `{{cleanupSSRContent}}` so removal happens at render time, avoiding a flash of no content. Only used in cleanup mode (not rehydrate mode).
- **`cleanupShoebox()`** — manually restore original `fetch`.
- **`isSSRRendered()`** — returns `true` if SSR boundary markers are present in the DOM. Useful for conditionally running client-side setup that should only happen on SSR-rendered pages.

## Monorepo development

This repo contains five packages:

| Package                      | Description                |
| ---------------------------- | -------------------------- |
| `packages/vite-ember-ssr`    | Core library + test suites |
| `packages/test-app`          | Ember test app (SSR)       |
| `packages/test-app-ssg`      | Ember test app (SSG)       |
| `packages/test-app-combined` | Ember test app (SSR + SSG) |
| `packages/test-server`       | Fastify SSR server         |

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

MIT
