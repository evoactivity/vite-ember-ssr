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

    it('fails the render (500) on an error thrown from a timer during it', async () => {
      const rendered = await app.renderRoute('/throw-later');

      expect(rendered.statusCode).toBe(500);
      expect(rendered.error.message).toContain(
        'thrown from a timer during the render',
      );
    });

    it('fails the render (500) on a promise left rejected during it', async () => {
      const rendered = await app.renderRoute('/reject-later');

      expect(rendered.statusCode).toBe(500);
      expect(rendered.error.message).toContain('rejected during the render');
    });

    it('keeps rendering, with the same app, after such an error', async () => {
      const before = await app.renderRoute('/before');
      await app.renderRoute('/throw-later');
      const after = await app.renderRoute('/after');

      const visit = (rendered) => Number(rendered.body.match(/visit (\d+)/)[1]);

      expect(after.statusCode).toBe(200);
      expect(visit(after)).toBe(visit(before) + 2);
    });
  });
}
