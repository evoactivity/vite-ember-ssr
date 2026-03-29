/**
 * Combined SSR + SSG server for test-app-combined.
 *
 * Serves prerendered static HTML files first (from dist/client/),
 * falling back to dynamic SSR for routes without prerendered files.
 *
 * This demonstrates the recommended combined-mode server pattern.
 */
import Fastify from 'fastify';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = parseInt(process.env.PORT ?? '4200', 10);
const host = process.env.HOST ?? 'localhost';

const combinedDist = resolve(__dirname, '../test-app-combined/dist');
const clientDir = resolve(combinedDist, 'client');
const serverDir = resolve(combinedDist, 'server');

async function start() {
  const app = Fastify({ logger: true });

  await app.register(import('@fastify/compress'));

  await app.register(import('@fastify/static'), {
    root: clientDir,
    prefix: '/',
    wildcard: false,
    index: false,
    serveDotFiles: false,
  });

  // Build an async createApp factory that lazily imports the SSR
  // bundle inside withBrowserGlobals where window exists.
  const serverEntryPath = resolve(serverDir, 'app-ssr.mjs');
  const createApp = async () => {
    const appModule = await import(serverEntryPath);
    const { createSsrApp } = appModule;

    if (typeof createSsrApp !== 'function') {
      throw new Error(
        'Could not find `createSsrApp` export in dist/server/app-ssr.mjs. ' +
          'Make sure you ran `pnpm build:all` in the test-app-combined package.',
      );
    }

    return createSsrApp();
  };

  // Read the SSR template preserved by emberSsg during the client build.
  // When both plugins are used together, emberSsg copies index.html to
  // _template.html before overwriting it with prerendered content.
  const ssrTemplate = await readFile(
    resolve(clientDir, '_template.html'),
    'utf-8',
  );

  app.get('*', async (request, reply) => {
    const url = request.url;

    if (isAssetRequest(url)) {
      return;
    }

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
        createApp,
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

  try {
    await app.listen({ port, host });
    console.log(`\n  Combined SSR+SSG server at http://${host}:${port}\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

/**
 * Resolve the path to a prerendered HTML file for a given URL.
 * '/' → dist/client/index.html
 * '/about' → dist/client/about/index.html
 */
function resolvePrerenderedPath(clientDir, url) {
  const pathname = url.split('?')[0].replace(/\/$/, '') || '/';
  if (pathname === '/') {
    return resolve(clientDir, 'index.html');
  }
  return resolve(clientDir, pathname.slice(1), 'index.html');
}

function isAssetRequest(url) {
  const assetExtensions =
    /\.(js|mjs|css|ts|tsx|jsx|json|map|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webp|avif|webm|mp4)(\?.*)?$/;
  return assetExtensions.test(url);
}

start();
