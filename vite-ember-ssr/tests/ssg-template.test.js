/**
 * The `template` option of emberSsg: the prerendered pages use another
 * built HTML file as their template, and index.html stays as it is.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(__dirname, '../../test-apps/test-app-ssg-template/dist');

const MARKER = '<meta name="ssr-template" content="ssr.html" />';

describe('SSG template option', () => {
  it('prerenders each route with the given file as the template', async () => {
    expect(await readFile(resolve(dist, 'index.html'), 'utf-8')).toContain(
      MARKER,
    );
    expect(
      await readFile(resolve(dist, 'about/index.html'), 'utf-8'),
    ).toContain(MARKER);
  });

  it('renders the route content into that template', async () => {
    const html = await readFile(resolve(dist, 'about/index.html'), 'utf-8');

    expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
    expect(html).toContain('<!--%+b:');
  });

  it('leaves the built ssr.html as it is', async () => {
    const html = await readFile(resolve(dist, 'ssr.html'), 'utf-8');

    expect(html).toContain(MARKER);
    expect(html).toContain('<!-- VITE_EMBER_SSR_HEAD -->');
  });
});
