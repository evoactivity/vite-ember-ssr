import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.argv.includes('--dev');
const port = parseInt(process.env.PORT ?? '4200', 10);
const host = process.env.HOST ?? 'localhost';

// Paths to the test-app package
const testAppRoot = resolve(__dirname, '../test-app');
const testAppDist = resolve(testAppRoot, 'dist');

async function start() {
  const app = Fastify({ logger: true });

  if (isDev) {
    await setupDevMode(app);
  } else {
    await setupProductionMode(app);
  }

  try {
    await app.listen({ port, host });
    console.log(`\n  SSR server running at http://${host}:${port} (${isDev ? 'development' : 'production'})\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// ─── Development Mode ────────────────────────────────────────────────

async function setupDevMode(app) {
  const { createServer: createViteServer } = await import('vite');

  // CWD must be the Ember app root for @embroider/vite's plugins
  process.chdir(testAppRoot);

  const vite = await createViteServer({
    root: testAppRoot,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  // Mount Vite's middleware on Fastify
  await app.register(import('@fastify/middie'));
  app.use(vite.middlewares);

  // Catch-all route for SSR
  app.get('*', async (request, reply) => {
    const url = request.url;

    if (isAssetRequest(url)) {
      return;
    }

    try {
      let template = await readFile(resolve(testAppRoot, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);

      const { createSsrApp } = await vite.ssrLoadModule(
        resolve(testAppRoot, 'app/app-ssr.ts'),
      );

      if (typeof createSsrApp !== 'function') {
        throw new Error(
          'Could not find `createSsrApp` export in app/app-ssr.ts. ' +
          'Make sure your Ember app exports a createSsrApp factory function.',
        );
      }

      const { html, statusCode, error } = await render({
        url,
        template,
        createApp: createSsrApp,
        shoebox: true,
      });

      if (error) app.log.error(error, 'SSR rendering error');

      return reply.code(statusCode).type('text/html').send(html);

    } catch (e) {
      if (e instanceof Error) {
        vite.ssrFixStacktrace(e);
      }
      app.log.error(e, 'SSR request failed');
      return reply.code(500).type('text/plain').send(e instanceof Error ? e.stack : String(e));
    }
  });
}

// ─── Production Mode ─────────────────────────────────────────────────

async function setupProductionMode(app) {
  await app.register(import('@fastify/compress'));

  await app.register(import('@fastify/static'), {
    root: resolve(testAppDist, 'client'),
    prefix: '/',
    wildcard: false,
    index: false,          // Don't serve index.html for directory requests
    serveDotFiles: false,
  });

  // Load the pre-built SSR bundle
  const serverEntryPath = resolve(testAppDist, 'server/app-ssr.mjs');
  const appModule = await import(serverEntryPath);
  const { createSsrApp } = appModule;

  if (typeof createSsrApp !== 'function') {
    throw new Error(
      'Could not find `createSsrApp` export in dist/server/app-ssr.mjs. ' +
      'Make sure you ran `pnpm build:all` in the test-app package.',
    );
  }

  const template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');

  app.get('*', async (request, reply) => {
    const url = request.url;

    if (isAssetRequest(url)) {
      return;
    }

    try {
      const { html, statusCode, error } = await render({
        url,
        template,
        createApp: createSsrApp,
        shoebox: true,
      });

      if (error) app.log.error(error, 'SSR rendering error');

      return reply.code(statusCode).type('text/html').send(html);

    } catch (e) {
      app.log.error(e, 'SSR request failed');
      return reply.code(500).type('text/plain').send(e instanceof Error ? e.stack : String(e));
    }
  });
}

// ─── Utilities ───────────────────────────────────────────────────────

function isAssetRequest(url) {
  const assetExtensions = /\.(js|mjs|css|ts|tsx|jsx|json|map|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webp|avif|webm|mp4)(\?.*)?$/;
  return assetExtensions.test(url);
}

start();
