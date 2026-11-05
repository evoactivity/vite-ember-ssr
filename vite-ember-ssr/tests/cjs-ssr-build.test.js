import { describe, it, expect } from 'vitest';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { emberSsg, emberSsr } from 'vite-ember-ssr/vite-plugin';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixture = resolve(__dirname, 'fixtures/cjs-require');

async function buildSsr(plugin) {
  // The plugins choose the output directory (dist/server, dist): read it back.
  let outDir;

  try {
    await build({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        plugin,
        {
          name: 'read-out-dir',
          configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
          },
        },
      ],
      build: { ssr: 'entry.js' },
    });

    const mod = await import(pathToFileURL(join(outDir, 'entry.js')).href);

    return mod.result;
  } finally {
    await rm(resolve(fixture, 'dist'), { recursive: true, force: true });
  }
}

describe('CommonJS in an SSR build', () => {
  it('emberSsr() keeps require() between CommonJS modules working', async () => {
    expect(await buildSsr(emberSsr())).toBe('toggled atStart');
  });

  it('emberSsg() keeps require() between CommonJS modules working', async () => {
    expect(await buildSsr(emberSsg({ routes: [] }))).toBe('toggled atStart');
  });
});
