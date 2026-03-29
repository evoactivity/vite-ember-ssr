/**
 * SSR server for test-app-lazy-ssr.
 *
 * Production-only server that loads the pre-built SSR bundle and renders
 * routes on demand. Used to test lazy-loaded routes (@embroider/router)
 * with the vite-ember-ssr SSR plugin.
 */
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = parseInt(process.env.PORT ?? '4200', 10);
const host = process.env.HOST ?? 'localhost';

// Paths to the test-app-lazy-ssr package
const testAppRoot = resolve(__dirname, '../test-app-lazy-ssr');
const testAppDist = resolve(testAppRoot, 'dist');

async function start() {
  const app = Fastify({ logger: true });

  await app.register(import('@fastify/compress'));

  await app.register(import('@fastify/static'), {
    root: resolve(testAppDist, 'client'),
    prefix: '/',
    wildcard: false,
    index: false,
    serveDotFiles: false,
  });

  // Load the pre-built SSR bundle
  const serverEntryPath = resolve(testAppDist, 'server/app-ssr.mjs');
  const appModule = await import(serverEntryPath);
  const { createSsrApp } = appModule;

  if (typeof createSsrApp !== 'function') {
    throw new Error(
      'Could not find `createSsrApp` export in dist/server/app-ssr.mjs. ' +
        'Make sure you ran `pnpm build:all` in the test-app-lazy-ssr package.',
    );
  }

  const template = await readFile(
    resolve(testAppDist, 'client/index.html'),
    'utf-8',
  );

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
        shoebox: false,
        rehydrate: false,
      });

      if (error) app.log.error(error, 'SSR rendering error');

      return reply.code(statusCode).type('text/html').send(html);
    } catch (e) {
      app.log.error(e, 'SSR request failed');
      return reply
        .code(500)
        .type('text/plain')
        .send(e instanceof Error ? e.stack : String(e));
    }
  });

  try {
    await app.listen({ port, host });
    console.log(
      `\n  Lazy SSR server running at http://${host}:${port} (production)\n`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────

function isAssetRequest(url) {
  const assetExtensions =
    /\.(js|mjs|css|ts|tsx|jsx|json|map|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webp|avif|webm|mp4)(\?.*)?$/;
  return assetExtensions.test(url);
}

start();
