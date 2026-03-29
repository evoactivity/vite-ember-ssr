import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from 'vite';
import { join, dirname } from 'node:path';
import { mkdir, writeFile, readFile, rm, copyFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
export const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';

/**
 * Default noExternal patterns for Ember ecosystem packages.
 *
 * These packages must be processed through Vite's transform pipeline
 * (Babel, template compilation, etc.) rather than loaded as raw Node ESM.
 */
const EMBER_SSR_NO_EXTERNAL: (RegExp | string)[] = [
  /^@ember\//,
  /^@glimmer\//,
  /^@embroider\//,
  /^@warp-drive\//,
  /^ember-/,
  'decorator-transforms',
];

/**
 * Flatten and filter a Vite plugins array, which may contain nested arrays,
 * falsy values, and Promise-wrapped entries.
 */
function flatPlugins(plugins: PluginOption[] | undefined): Plugin[] {
  if (!plugins) return [];
  return (plugins as unknown[])
    .flat(Infinity)
    .filter(
      (p): p is Plugin => p != null && typeof p === 'object' && 'name' in p,
    );
}

export interface EmberSsrPluginOptions {
  /**
   * Output directory for the client build.
   * @default 'dist/client'
   */
  clientOutDir?: string;

  /**
   * Output directory for the SSR build.
   * @default 'dist/server'
   */
  serverOutDir?: string;

  /**
   * Additional packages to add to `ssr.noExternal` beyond the
   * built-in Ember ecosystem patterns. Accepts strings and RegExps.
   */
  additionalNoExternal?: (string | RegExp)[];
}

/**
 * Vite plugin that configures SSR support for Ember applications.
 *
 * Handles all SSR-related Vite configuration automatically:
 *
 * - Injects `ssr.noExternal` for Ember ecosystem packages
 * - Sets build defaults: `dist/client` for client builds,
 *   `dist/server` with `target: 'node22'` for SSR builds
 * - Writes a `package.json` with `"type": "module"` to the SSR
 *   build output directory (needed for Node ESM compatibility)
 */
export function emberSsr(options: EmberSsrPluginOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'vite-ember-ssr',

    config(_userConfig, env): UserConfig {
      const noExternal = [
        ...EMBER_SSR_NO_EXTERNAL,
        ...(options.additionalNoExternal ?? []),
      ];

      // During the SSG child build, only provide ssr.noExternal —
      // don't override build.outDir or other build settings
      // (the SSG plugin sets them explicitly via inline config).
      if (process.env.__VITE_EMBER_SSG_CHILD__) {
        return { ssr: { noExternal } };
      }

      if (env.isSsrBuild) {
        return {
          ssr: { noExternal },
          build: {
            outDir: options.serverOutDir ?? 'dist/server',
            target: 'node22',
            sourcemap: true,
            minify: false,
          },
        };
      }

      return {
        ssr: { noExternal },
        build: {
          outDir: options.clientOutDir ?? 'dist/client',
        },
      };
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    async closeBundle() {
      // Only write package.json for SSR builds
      if (!resolvedConfig.build.ssr) return;

      // Don't interfere with the SSG child build's temp directory
      if (process.env.__VITE_EMBER_SSG_CHILD__) return;

      const outDir = join(resolvedConfig.root, resolvedConfig.build.outDir);
      const targetPath = join(outDir, 'package.json');
      await mkdir(outDir, { recursive: true });
      await writeFile(
        targetPath,
        JSON.stringify({ type: 'module' }, null, 2),
        'utf-8',
      );
    },
  };
}

// ─── SSG Plugin ──────────────────────────────────────────────────────

export interface EmberSsgPluginOptions {
  /**
   * Routes to prerender as static HTML files.
   *
   * Each entry is a route path (without leading slash).
   * 'index' produces `index.html` at the root, other routes produce
   * `<route>/index.html` (e.g., 'about' → `about/index.html`).
   *
   * @example
   * ```js
   * emberSsg({
   *   routes: ['index', 'about', 'pokemon', 'pokemon/charmander'],
   * })
   * ```
   */
  routes: string[];

  /**
   * The SSR entry module path, relative to the project root.
   * This file must export a `createSsrApp` function.
   * @default 'app/app-ssr.ts'
   */
  ssrEntry?: string;

  /**
   * Enable shoebox (fetch replay) for prerendered pages.
   *
   * When true, fetch responses from route model hooks are captured during
   * prerendering and serialized into the HTML. The client calls
   * `installShoebox()` before boot to replay those responses and avoid
   * duplicate API requests.
   *
   * @default false
   */
  shoebox?: boolean;

  /**
   * Output directory for the client build.
   * @default 'dist'
   */
  outDir?: string;

  /**
   * Enable Glimmer rehydration for prerendered pages.
   *
   * When `true`, the server renders with `_renderMode: 'serialize'`,
   * annotating the DOM with Glimmer markers. The client boots with
   * `app.visit(url, { _renderMode: 'rehydrate' })` to reuse the
   * static DOM instead of replacing it.
   *
   * When `false` (default), boundary markers are emitted and the
   * client uses `cleanupSSRContent()` in the application template
   * to remove the SSR content before Ember renders fresh.
   *
   * @default false
   */
  rehydrate?: boolean;

  /**
   * Additional packages to add to `ssr.noExternal` beyond the
   * built-in Ember ecosystem patterns.
   */
  additionalNoExternal?: (string | RegExp)[];
}

/**
 * Vite plugin for Static Site Generation (SSG) of Ember applications.
 *
 * Prerenders the specified routes to static HTML files at build time.
 * Fully self-contained — only a single `vite build` is needed.
 *
 * After the client build completes, the plugin runs a second SSR build
 * via `vite.build()` to produce a bundled SSR entry module, imports it,
 * renders each route using HappyDOM, and writes the resulting HTML files
 * into the client output directory. The temporary SSR bundle is cleaned
 * up automatically.
 *
 * @example
 * ```js
 * // vite.config.mjs
 * import { emberSsg } from 'vite-ember-ssr/vite-plugin';
 *
 * export default defineConfig({
 *   plugins: [
 *     ember(),
 *     babel({ babelHelpers: 'runtime', extensions }),
 *     emberSsg({
 *       routes: ['index', 'about', 'pokemon', 'pokemon/charmander'],
 *     }),
 *   ],
 * });
 * ```
 */
export function emberSsg(options: EmberSsgPluginOptions): Plugin {
  const {
    routes,
    ssrEntry = 'app/app-ssr.ts',
    shoebox = false,
    rehydrate = false,
    additionalNoExternal = [],
  } = options;

  // Track whether the user explicitly provided outDir
  const explicitOutDir = options.outDir;

  let resolvedConfig: ResolvedConfig;

  // Whether emberSsr is also registered — detected in config() hook
  let isCombined = false;

  return {
    name: 'vite-ember-ssg',

    config(userConfig): UserConfig {
      const noExternal = [...EMBER_SSR_NO_EXTERNAL, ...additionalNoExternal];

      // During the child SSR build, only provide ssr.noExternal —
      // don't override build.outDir (the parent sets it explicitly).
      if (process.env.__VITE_EMBER_SSG_CHILD__) {
        return { ssr: { noExternal } };
      }

      // Detect if emberSsr is also registered in this config.
      // When combined, defer build.outDir to emberSsr so that
      // prerendered files land in the SSR client directory.
      isCombined = flatPlugins(userConfig.plugins).some(
        (p) => p.name === 'vite-ember-ssr',
      );

      // Only set outDir when:
      // - the user explicitly passed outDir to emberSsg, OR
      // - emberSsr is NOT present (standalone SSG mode, default 'dist')
      const outDir = explicitOutDir ?? (isCombined ? undefined : 'dist');

      return {
        ssr: { noExternal },
        ...(outDir != null ? { build: { outDir } } : {}),
      };
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    async closeBundle() {
      // Don't prerender during SSR builds (if the user also has emberSsr)
      if (resolvedConfig.build.ssr) return;

      // Prevent recursive prerendering when the child build
      // loads the same config file and re-registers this plugin.
      if (process.env.__VITE_EMBER_SSG_CHILD__) return;

      const { build: viteBuild } = await import('vite');
      const { render } = await import('./server.js');

      const root = resolvedConfig.root;
      const clientDir = join(root, resolvedConfig.build.outDir);
      const ssrOutDir = join(root, '.ssg-tmp');

      console.log('\n[vite-ember-ssg] Prerendering routes...');

      // Read the built client index.html as template
      const templatePath = join(clientDir, 'index.html');
      let template: string;
      try {
        template = await readFile(templatePath, 'utf-8');
      } catch (e) {
        console.error(
          `[vite-ember-ssg] Failed to read template at ${templatePath}.`,
        );
        throw e;
      }

      // When combined with emberSsr, preserve the original index.html
      // as _template.html before prerendering overwrites it. The
      // production server reads _template.html for dynamic SSR rendering.
      if (isCombined) {
        const savedTemplatePath = join(clientDir, '_template.html');
        await copyFile(templatePath, savedTemplatePath);
        console.log(
          `  [vite-ember-ssg] Saved SSR template → ${savedTemplatePath.replace(root + '/', '')}`,
        );
      }

      // ── Step 1: Build the SSR bundle ────────────────────────────
      // Run vite.build() with ssr entry to produce a fully bundled
      // ESM module. This handles all CJS→ESM transforms, Babel,
      // Glimmer template compilation, etc. at build time.
      process.env.__VITE_EMBER_SSG_CHILD__ = '1';

      try {
        await viteBuild({
          root,
          configFile: resolvedConfig.configFile || undefined,
          logLevel: 'warn',
          build: {
            ssr: ssrEntry,
            outDir: ssrOutDir,
            target: 'node22',
            minify: false,
            sourcemap: false,
          },
          ssr: {
            noExternal: [...EMBER_SSR_NO_EXTERNAL, ...additionalNoExternal],
          },
        });
      } catch (e) {
        console.error('[vite-ember-ssg] SSR build failed:', e);
        throw e;
      } finally {
        delete process.env.__VITE_EMBER_SSG_CHILD__;
      }

      // Write package.json so Node loads the bundle as ESM
      await writeFile(
        join(ssrOutDir, 'package.json'),
        JSON.stringify({ type: 'module' }, null, 2),
        'utf-8',
      );

      // ── Step 2: Import the SSR bundle and prerender ─────────────
      let successCount = 0;
      let errorCount = 0;

      try {
        // Determine the output filename — Vite names SSR output
        // after the entry: 'app/app-ssr.ts' → 'app-ssr.mjs'.
        // Some Vite versions using Rolldown output '.js' instead of '.mjs',
        // so we try both extensions.
        const entryBasename = ssrEntry
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, '');

        let ssrBundlePath = join(ssrOutDir, `${entryBasename}.mjs`);
        try {
          await access(ssrBundlePath);
        } catch {
          ssrBundlePath = join(ssrOutDir, `${entryBasename}.js`);
        }
        const ssrBundleURL = pathToFileURL(ssrBundlePath).href;

        // Build an async createApp factory that lazily imports the SSR
        // bundle. The import() happens inside withBrowserGlobals (via
        // render → renderEmberApp) so browser globals like `window`
        // exist when module-level code runs. This is required for apps
        // using @embroider/router lazy routes, whose route-splitting.ts
        // assigns `window._embroiderRouteBundles_` at module scope.
        //
        // ES module import() caches by URL, so the bundle is only
        // loaded once — subsequent calls return the cached module.
        const createApp = async () => {
          const ssrModule = await import(ssrBundleURL);
          const createSsrApp = ssrModule.createSsrApp;

          if (typeof createSsrApp !== 'function') {
            throw new Error(
              `SSR entry '${ssrEntry}' does not export a 'createSsrApp' function. ` +
                `Found exports: ${Object.keys(ssrModule).join(', ')}`,
            );
          }

          return createSsrApp();
        };

        // Prerender each route
        for (const route of routes) {
          const url = route === 'index' ? '/' : `/${route}`;

          try {
            const result = await render({
              url,
              template,
              createApp,
              shoebox,
              rehydrate,
            });

            if (result.error) {
              console.error(
                `  [vite-ember-ssg] Error rendering ${url}:`,
                result.error.message,
              );
              errorCount++;
              continue;
            }

            // 'index' → index.html (overwrite the shell)
            // 'about' → about/index.html
            // 'pokemon/charmander' → pokemon/charmander/index.html
            const outputPath =
              route === 'index'
                ? join(clientDir, 'index.html')
                : join(clientDir, route, 'index.html');

            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, result.html, 'utf-8');

            console.log(
              `  [vite-ember-ssg] ${url} → ${outputPath.replace(root + '/', '')}`,
            );
            successCount++;
          } catch (e) {
            console.error(
              `  [vite-ember-ssg] Failed to prerender ${url}:`,
              e instanceof Error ? e.message : e,
            );
            errorCount++;
          }
        }
      } finally {
        // ── Step 3: Clean up the temporary SSR bundle ─────────────
        await rm(ssrOutDir, { recursive: true, force: true });
      }

      console.log(
        `[vite-ember-ssg] Done. ${successCount} pages generated` +
          (errorCount > 0 ? `, ${errorCount} errors` : '') +
          '.',
      );

      if (errorCount > 0 && successCount === 0) {
        throw new Error('[vite-ember-ssg] All routes failed to prerender.');
      }
    },
  };
}

export default emberSsr;
