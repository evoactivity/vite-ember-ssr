# Fastify combined SSR + SSG server example

Minimal Fastify server that serves prerendered static HTML files and falls back to dynamic SSR for routes that weren't prerendered at build time.

## Prerequisites

Your Vite config uses both plugins:

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

Build both steps:

```sh
vite build                      # client assets + SSG prerender → dist/client
vite build --ssr app/app-ssr.ts # server bundle → dist/server
```

## Dependencies

```sh
pnpm add fastify @fastify/static @fastify/compress vite-ember-ssr
```

## Server (`server.js`)

```js
import Fastify from 'fastify';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = parseInt(process.env.PORT ?? '4200', 10);

// Point at your Ember app's dist directory
const appDist = resolve(__dirname, '../my-ember-app/dist');
const clientDir = resolve(appDist, 'client');
const serverDir = resolve(appDist, 'server');

async function start() {
  const app = Fastify({ logger: true });

  await app.register(import('@fastify/compress'));

  // Serve static assets (JS, CSS, images) from dist/client/
  await app.register(import('@fastify/static'), {
    root: clientDir,
    prefix: '/',
    wildcard: false,
    index: false, // Don't serve index.html for directory requests
  });

  // Load the pre-built SSR bundle
  const { createSsrApp } = await import(resolve(serverDir, 'app-ssr.mjs'));

  // Read the SSR template preserved by emberSsg during the client build.
  // When both plugins are used together, emberSsg copies index.html to
  // _template.html before overwriting it with prerendered content.
  // This file contains the original SSR markers needed for dynamic rendering.
  const ssrTemplate = await readFile(
    resolve(clientDir, '_template.html'),
    'utf-8',
  );

  app.get('*', async (request, reply) => {
    const url = request.url;

    // Skip SSR for static asset requests
    if (isAsset(url)) return;

    // Step 1: Check for a prerendered static file
    const prerenderedPath = resolvePrerenderedPath(clientDir, url);
    try {
      await access(prerenderedPath);
      const html = await readFile(prerenderedPath, 'utf-8');
      app.log.info({ url, prerendered: true }, 'Serving prerendered HTML');
      return reply.code(200).type('text/html').send(html);
    } catch {
      // No prerendered file — fall through to dynamic SSR
    }

    // Step 2: Dynamic SSR fallback
    try {
      const { html, statusCode, error } = await render({
        url,
        template: ssrTemplate,
        createApp: createSsrApp,
        shoebox: true,
      });

      if (error) app.log.error(error, 'SSR rendering error');
      app.log.info({ url, prerendered: false }, 'Dynamic SSR render');

      return reply.code(statusCode).type('text/html').send(html);
    } catch (e) {
      app.log.error(e, 'SSR request failed');
      return reply
        .code(500)
        .type('text/plain')
        .send(e instanceof Error ? e.stack : String(e));
    }
  });

  await app.listen({ port });
}

// ─── Utilities ───────────────────────────────────────────────────────

/**
 * Resolve the path to a prerendered HTML file for a given URL.
 * '/'      → dist/client/index.html
 * '/about' → dist/client/about/index.html
 */
function resolvePrerenderedPath(clientDir, url) {
  const pathname = url.split('?')[0].replace(/\/$/, '') || '/';
  if (pathname === '/') {
    return resolve(clientDir, 'index.html');
  }
  return resolve(clientDir, pathname.slice(1), 'index.html');
}

function isAsset(url) {
  return /\.(js|mjs|css|ts|tsx|jsx|json|map|ico|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|webp|avif)(\?.*)?$/.test(
    url,
  );
}

start();
```

## Running

```sh
node server.js
```

## How it works

1. **Prerendered routes** (`/`, `/about`, `/contact`) are served directly as static HTML files from `dist/client/`. No Node.js rendering cost — the response is just a file read.

2. **All other routes** fall through to dynamic SSR using `render()` from `vite-ember-ssr/server`. The server reads `_template.html` (the original `index.html` with SSR markers) and renders the route on-demand with HappyDOM.

3. **`_template.html`** is created automatically by `emberSsg` during the client build. It's a copy of the original `index.html` before prerendering overwrites it. This file contains the `<!-- VITE_EMBER_SSR_HEAD -->` and `<!-- VITE_EMBER_SSR_BODY -->` markers that `render()` needs.

## Key points

- **`_template.html`** — When `emberSsg` detects `emberSsr` in the same config, it preserves the original `index.html` as `_template.html` before overwriting it with prerendered content. Your server reads this file for dynamic SSR.
- **`index: false`** on `@fastify/static` prevents it from serving `index.html` for directory requests, which would bypass the catch-all handler.
- **`shoebox: true`** captures `fetch` responses during dynamic SSR and serializes them into the HTML. The client's `installShoebox()` replays them to avoid duplicate API requests.
- **Always `return reply`** from async Fastify handlers to prevent stream lifecycle issues.

## Rehydration

Both the SSG prerender and the dynamic SSR fallback support rehydrate mode independently.

**SSG prerender:** pass `rehydrate: true` to `emberSsg()` in your Vite config. The prerendered HTML files will include Glimmer serialization markers instead of boundary markers.

```js
// vite.config.mjs
emberSsg({
  routes: ['index', 'about', 'contact'],
  rehydrate: true,
}),
```

**Dynamic SSR fallback:** pass `rehydrate: true` to `render()` in your server:

```js
const { html, statusCode, error } = await render({
  url,
  template: ssrTemplate,
  createApp: createSsrApp,
  shoebox: true,
  rehydrate: true,
});
```

You can use the same mode for both (simplest), or mix them — e.g., rehydrate for prerendered pages and cleanup for dynamic SSR, or vice versa. If both use the same mode, the client entry is straightforward. If they differ, the client needs to detect which mode was used (e.g., check for boundary markers with `isSSRRendered()`). See the main [README](../packages/vite-ember-ssr/README.md#client-boot-modes) for full details on both client boot modes.

## Build output reference

```
dist/
  client/
    _template.html            ← original index.html with SSR markers (for dynamic rendering)
    index.html                ← prerendered index route
    about/index.html          ← prerendered about route
    contact/index.html        ← prerendered contact route
    assets/
      main-abc123.js          ← client JS bundle
      main-abc123.css         ← client CSS bundle
  server/
    app-ssr.mjs               ← SSR server bundle
    package.json              ← { "type": "module" }
```
