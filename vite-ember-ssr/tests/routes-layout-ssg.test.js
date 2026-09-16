/**
 * Routes layout SSG tests.
 *
 * The app keeps each route's files together in `app/routes/<name>/`:
 * - `+template.gts`
 * - the route's own components
 * - the route's own CSS
 *
 * It maps those files to resolver keys itself.
 * Nothing lives in `app/templates/`.
 * Every lazy chunk is named `_template`.
 *
 * The CSS manifest and the prerendered pages
 * must still pair each route with its CSS.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(
  __dirname,
  '../../test-apps/test-app-routes-layout-ssg/dist',
);

const ABOUT = 'app/routes/about/+template.gts';
const CONTACT = 'app/routes/contact/+template.gts';

let cssManifest;

async function readHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(dist, 'index.html')
      : resolve(dist, route, 'index.html');
  return readFile(filePath, 'utf-8');
}

function links(html) {
  return html.match(/<link rel="stylesheet" href="[^"]+">/g) ?? [];
}

beforeAll(async () => {
  cssManifest = JSON.parse(
    await readFile(resolve(dist, 'css-manifest.json'), 'utf-8'),
  );
});

describe('Routes layout CSS manifest', () => {
  it('keys entries by the imported module path', () => {
    expect(Object.keys(cssManifest).sort()).toEqual([ABOUT, CONTACT]);
  });

  it('lists the route CSS, the route-only component CSS, and the shared CSS', () => {
    // about.css and info.css merge into the route chunk's CSS,
    // shared-badge.css is split out because contact uses it too.
    expect(cssManifest[ABOUT]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/assets\/_template-[a-zA-Z0-9_-]+\.css$/),
        expect.stringMatching(/\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/),
      ]),
    );
    expect(cssManifest[ABOUT].length).toBe(2);
    expect(cssManifest[CONTACT]).toEqual([
      expect.stringMatching(/\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/),
    ]);
  });
});

describe('Routes layout prerendered pages', () => {
  it('renders the lazy route content', async () => {
    const html = await readHtml('about');
    expect(html).toContain('data-route="about"');
    expect(html).toContain('data-component="about-info"');
  });

  it('links every CSS file of the about route', async () => {
    const html = await readHtml('about');
    for (const href of cssManifest[ABOUT]) {
      expect(html).toContain(`<link rel="stylesheet" href="${href}">`);
    }
  });

  it('links only the shared CSS on the contact route', async () => {
    const html = await readHtml('contact');
    expect(links(html)).toEqual(
      cssManifest[CONTACT].map(
        (href) => `<link rel="stylesheet" href="${href}">`,
      ),
    );
  });

  it('links no lazy CSS on the eager index route', async () => {
    const html = await readHtml('index');
    expect(html).toContain('data-route="index"');
    expect(links(html)).toEqual([]);
  });
});
