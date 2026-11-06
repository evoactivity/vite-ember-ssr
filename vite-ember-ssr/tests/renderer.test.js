/**
 * The renderer itself (worker pool and dev mode), with a stand-in SSR bundle
 * instead of an Ember app: tests/fixtures/fake-ssr-app/app-ssr.mjs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmberApp } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const bundle = resolve(__dirname, 'fixtures/fake-ssr-app/app-ssr.mjs');

const modes = {
  'worker pool': () => createEmberApp(bundle, { workers: 1 }),
  dev: () =>
    createEmberApp(bundle, {
      dev: { ssrLoadModule: (path) => import(pathToFileURL(path).href) },
    }),
};

for (const [mode, create] of Object.entries(modes)) {
  describe(`renderer (${mode})`, () => {
    let app;

    beforeAll(async () => {
      app = await create();
    });

    afterAll(async () => {
      await app.destroy();
    });

    it('returns the attributes the render set on <html>', async () => {
      const rendered = await app.renderRoute('/html-attrs');

      expect(rendered.statusCode).toBe(200);
      expect(rendered.htmlAttrs).toEqual({ lang: 'es-MX', dir: 'ltr' });
    });

    it("doesn't carry one render's <html> attributes into the next", async () => {
      await app.renderRoute('/html-attrs');
      const rendered = await app.renderRoute('/other');

      expect(rendered.body).toContain('rendered /other');
      expect(rendered.htmlAttrs).toEqual({});
    });
  });
}
