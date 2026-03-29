# Fastify SSR server example

Minimal Fastify server with dev and production modes for `vite-ember-ssr`.

## Dependencies

```sh
pnpm add fastify @fastify/static @fastify/compress @fastify/middie vite-ember-ssr
```

## Server (`server.js`)

```js
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.argv.includes('--dev');

// Point at your Ember app package
const appRoot = resolve(__dirname, '../my-ember-app');
const appDist = resolve(appRoot, 'dist');

async function start() {
  const app = Fastify({ logger: true });

  if (isDev) {
    await setupDev(app);
  } else {
    await setupProd(app);
  }

  await app.listen({ port: 4200 });
}

// ─── Development ─────────────────────────────────────────────────────

async function setupDev(app) {
  const { createServer } = await import('vite');

  // CWD must be the Ember app root for @embroider/vite
  process.chdir(appRoot);

  const vite = await createServer({
    root: appRoot,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  await app.register(import('@fastify/middie'));
  app.use(vite.middlewares);

  app.get('*', async (request, reply) => {
    if (isAsset(request.url)) return;

    try {
      let template = await readFile(resolve(appRoot, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(request.url, template);

      const { createSsrApp } = await vite.ssrLoadModule(
        resolve(appRoot, 'app/app-ssr.ts'),
      );

      const { html, statusCode, error } = await render({
        url: request.url,
        template,
        createApp: createSsrApp,
        shoebox: true,
      });

      if (error) app.log.error(error, 'SSR rendering error');
      return reply.code(statusCode).type('text/html').send(html);
    } catch (e) {
      if (e instanceof Error) vite.ssrFixStacktrace(e);
      app.log.error(e);
      return reply
        .code(500)
        .type('text/plain')
        .send(e instanceof Error ? e.stack : String(e));
    }
  });
}

// ─── Production ──────────────────────────────────────────────────────

async function setupProd(app) {
  await app.register(import('@fastify/compress'));
  await app.register(import('@fastify/static'), {
    root: resolve(appDist, 'client'),
    prefix: '/',
    wildcard: false,
    index: false, // Don't serve index.html for directory requests
  });

  const { createSsrApp } = await import(resolve(appDist, 'server/app-ssr.mjs'));
  const template = await readFile(
    resolve(appDist, 'client/index.html'),
    'utf-8',
  );

  app.get('*', async (request, reply) => {
    if (isAsset(request.url)) return;

    try {
      const { html, statusCode, error } = await render({
        url: request.url,
        template,
        createApp: createSsrApp,
        shoebox: true,
      });

      if (error) app.log.error(error, 'SSR rendering error');
      return reply.code(statusCode).type('text/html').send(html);
    } catch (e) {
      app.log.error(e);
      return reply
        .code(500)
        .type('text/plain')
        .send(e instanceof Error ? e.stack : String(e));
    }
  });
}

// ─── Utilities ───────────────────────────────────────────────────────

function isAsset(url) {
  return /\.(js|mjs|css|ts|tsx|jsx|json|map|ico|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|webp|avif)(\?.*)?$/.test(
    url,
  );
}

start();
```

## Running

```sh
# Development (Vite middleware + HMR)
node server.js --dev

# Production (pre-built bundles)
vite build && vite build --ssr app/app-ssr.ts
node server.js
```

## Key points

- **`process.chdir(appRoot)`** is required in dev mode — `@embroider/vite` uses `process.cwd()` to locate the Ember app.
- **`index: false`** on `@fastify/static` prevents it from serving `index.html` for directory requests, which would bypass the SSR handler.
- **`shoebox: true`** captures `fetch` responses during SSR and serializes them into the HTML. The client's `installShoebox()` replays them to avoid duplicate API requests.
- **Always `return reply`** from async Fastify handlers to prevent stream lifecycle issues.

## Rehydration

By default, SSR uses **cleanup mode** — the server wraps rendered content in boundary markers, and `cleanupSSRContent()` (called from the application template) removes the SSR content when Ember boots. To use **rehydrate mode** instead, pass `rehydrate: true` to `render()`:

```js
const { html, statusCode, error } = await render({
  url: request.url,
  template,
  createApp: createSsrApp,
  shoebox: true,
  rehydrate: true,
});
```

In rehydrate mode, the server renders with `_renderMode: 'serialize'`, annotating the DOM with Glimmer markers. The client must boot with `autoboot: false` and call `app.visit(url, { _renderMode: 'rehydrate' })`. No `cleanupSSRContent` is needed. See the main [README](../packages/vite-ember-ssr/README.md#client-boot-modes) for full client-side setup.
