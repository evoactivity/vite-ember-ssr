# vite-ember-ssr

> [!WARNING]
> **EXPERIMENTAL** — This project is in early development and targets **compatless** Ember apps only (no `@embroider/compat`, no `ember-cli-build.js`, no `classicEmberSupport()`). APIs will change. Do not use in production.

Vite plugin and SSR/SSG runtime for Ember.js applications. Uses [HappyDOM](https://github.com/capricorn86/happy-dom) for server-side rendering — no FastBoot, no VM sandbox.

Two modes are supported:

- **SSR** (`emberSsr`) — server renders pages on each request at runtime. Requires a Node.js server.
- **SSG** (`emberSsg`) — prerenders specified routes to static HTML files at build time. A single `vite build` produces deploy-ready files. No server required.

## Architecture

- **HappyDOM Window** provides a full per-request browser-like environment. Ember runs directly in the Node.js process with globals swapped per request.
- **`Application.visit(url)`** drives the entire render cycle server-side.
- **No hydration yet** — the client boots normally and replaces SSR content. SSR provides the initial visual while JS loads.
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
  plugins: [ember(), babel({ babelHelpers: 'runtime', extensions }), emberSsr()],
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
import { installShoebox, cleanupSSRContent } from 'vite-ember-ssr/client';

installShoebox();
cleanupSSRContent();
Application.create(config.APP);
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

#### 4. Client entry (`app/entry.ts`)

Same as SSR — call `installShoebox()` and `cleanupSSRContent()` before boot. See the SSR section above.

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

You can use both in the same project — `emberSsg` for public pages and `emberSsr` for dynamic routes — though they require separate Vite configs.

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
  outDir: 'dist', // default: output directory
  additionalNoExternal: [], // extend built-in ssr.noExternal patterns
});
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
import { installShoebox, cleanupSSRContent, cleanupShoebox, isSSRRendered } from 'vite-ember-ssr/client';
```

- **`installShoebox()`** — replay server-captured fetch responses, auto-restores `fetch` when all entries consumed.
- **`cleanupSSRContent()`** — remove SSR-rendered DOM nodes before client Ember boots.
- **`cleanupShoebox()`** — manually restore original `fetch`.
- **`isSSRRendered()`** — returns `true` if SSR boundary markers are present in the DOM. Useful for conditionally running client-side setup that should only happen on SSR-rendered pages.

## Monorepo development

This repo contains four packages:

| Package                   | Description                |
| ------------------------- | -------------------------- |
| `packages/vite-ember-ssr` | Core library + test suites |
| `packages/test-app`       | Ember test app (SSR)       |
| `packages/test-app-ssg`   | Ember test app (SSG)       |
| `packages/test-server`    | Fastify SSR server         |

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
