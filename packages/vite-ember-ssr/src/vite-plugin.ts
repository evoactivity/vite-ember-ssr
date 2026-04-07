import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from 'vite';
import { join, dirname } from 'node:path';
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
  access,
} from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
export const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';

/**
 * Name of the CSS manifest file generated during the client build.
 * Maps dynamic entry source modules to their associated CSS asset paths.
 */
export const CSS_MANIFEST_FILENAME = 'css-manifest.json';

/**
 * The CSS manifest maps Ember route names to the CSS files that Vite
 * extracted from their lazy-loaded template chunks during the client build.
 *
 * Route names use Ember's dot-separated convention for nested routes:
 * - `about` for `app/templates/about.gts`
 * - `blog.post` for `app/templates/blog/post.gts`
 *
 * Example:
 * ```json
 * {
 *   "about": ["/assets/about-VWk4xp3e.css"]
 * }
 * ```
 *
 * During SSR, the renderer queries the active route name from Ember's
 * router service and looks up CSS files to inject as `<link>` tags.
 */
export type CssManifest = Record<string, string[]>;

/**
 * Derives an Ember route name from a source module path following
 * Ember's conventional file layout.
 *
 * `app/templates/about.gts` → `about`
 * `app/templates/blog/post.gts` → `blog.post`
 * `app/templates/index.gts` → `index`
 *
 * Returns undefined if the path doesn't match the convention.
 */
function sourcePathToRouteName(
  facadeModuleId: string,
  root: string,
): string | undefined {
  // Make the path relative to the project root
  let relativePath = facadeModuleId;
  if (relativePath.startsWith(root)) {
    relativePath = relativePath.slice(root.length);
  }
  // Strip leading slash
  if (relativePath.startsWith('/')) {
    relativePath = relativePath.slice(1);
  }

  // Match app/templates/<route-path>.<ext>
  const match = relativePath.match(
    /^app\/templates\/(.+)\.(gts|gjs|hbs|ts|js)$/,
  );
  if (!match) return undefined;

  // Convert path separators to dots for nested routes
  return match[1].replace(/\//g, '.');
}

/**
 * Minimal type for a Rollup output chunk with Vite metadata.
 * We define this locally to avoid a direct dependency on the 'rollup' package.
 */
interface OutputChunkWithMeta {
  type: 'chunk';
  isDynamicEntry: boolean;
  isEntry: boolean;
  facadeModuleId: string | null;
  name: string;
  fileName: string;
  imports: string[];
  viteMetadata?: {
    importedCss?: Set<string>;
  };
}

/**
 * Walks the Rollup output bundle and collects CSS files associated
 * with dynamic entry chunks. These are CSS imports that Vite extracted
 * from code-split chunks (e.g., lazy-loaded route templates).
 *
 * The main entry's CSS is already linked in the HTML template by Vite,
 * so we only collect CSS from `isDynamicEntry` chunks.
 *
 * When a component with CSS is shared across multiple lazy routes,
 * Vite extracts the shared CSS into a separate chunk. We walk each
 * dynamic entry's static `imports` graph to collect CSS from those
 * shared chunks too, skipping the main entry chunk (whose CSS is
 * already in the HTML template).
 *
 * Keys are Ember route names derived from the source file path using
 * Ember's conventional `app/templates/` directory structure.
 */
function buildCssManifest(
  bundle: Record<string, { type: string }>,
  base: string,
  root: string,
): CssManifest {
  const manifest: CssManifest = {};

  // Build a lookup of fileName → chunk for walking the import graph.
  const chunksByFile = new Map<string, OutputChunkWithMeta>();
  const mainEntryFiles = new Set<string>();

  for (const [, output] of Object.entries(bundle)) {
    if (output.type !== 'chunk') continue;
    const chunk = output as unknown as OutputChunkWithMeta;
    chunksByFile.set(chunk.fileName, chunk);

    // Track main entry chunks so we can exclude their CSS.
    // Main entry CSS is already linked in the HTML template by Vite.
    if (chunk.isEntry && !chunk.isDynamicEntry) {
      mainEntryFiles.add(chunk.fileName);
    }
  }

  /**
   * Recursively collect all CSS from a chunk and its static imports,
   * excluding main entry chunks (whose CSS is already in the template).
   */
  function collectCss(
    fileName: string,
    seen: Set<string>,
    css: Set<string>,
  ): void {
    if (seen.has(fileName)) return;
    seen.add(fileName);

    // Don't collect CSS from the main entry — it's already in the HTML.
    if (mainEntryFiles.has(fileName)) return;

    const chunk = chunksByFile.get(fileName);
    if (!chunk) return;

    const importedCss = chunk.viteMetadata?.importedCss;
    if (importedCss) {
      for (const cssFile of importedCss) {
        css.add(cssFile);
      }
    }

    // Walk static imports (shared chunks extracted by Vite).
    for (const imp of chunk.imports) {
      collectCss(imp, seen, css);
    }
  }

  for (const [, output] of Object.entries(bundle)) {
    if (output.type !== 'chunk') continue;

    const chunk = output as unknown as OutputChunkWithMeta;

    // Only collect CSS from dynamic entries (code-split chunks).
    if (!chunk.isDynamicEntry) continue;

    // Collect CSS from this chunk and all its static imports.
    const css = new Set<string>();
    collectCss(chunk.fileName, new Set(), css);

    if (css.size === 0) continue;

    // Derive the Ember route name from the source module path.
    // If the path doesn't match Ember conventions, fall back to
    // the chunk name (e.g., 'about' from 'about-B5EiMzMx.js').
    const routeName = chunk.facadeModuleId
      ? (sourcePathToRouteName(chunk.facadeModuleId, root) ?? chunk.name)
      : chunk.name;

    if (!routeName) continue;

    // Prefix CSS paths with the base URL so they work as href values.
    const cssFiles = Array.from(css).map((c) => `${base}${c}`);

    if (cssFiles.length > 0) {
      manifest[routeName] = cssFiles;
    }
  }

  return manifest;
}

/**
 * Clears any user-specified `ssr.external` from the Vite config and
 * returns `ssr: { noExternal: [/./] }` to bundle all dependencies.
 *
 * Ember's virtual packages (`@glimmer/tracking`, `@ember/*`, etc.) are
 * provided by `ember-source` and not published as real npm packages.
 * When Vite externalizes a dependency that transitively imports one of
 * these virtual packages, Node's runtime module resolution fails under
 * pnpm's strict `node_modules` layout.
 *
 * Bundling everything avoids this class of failure entirely. SSR bundles
 * run server-side where bundle size is not a user-facing concern.
 *
 * In Vite, explicit `string[]` entries in `ssr.external` take precedence
 * over `ssr.noExternal` patterns, so we must also delete any
 * user-specified externals to ensure the `noExternal: [/./]` pattern
 * actually applies.
 *
 * See: https://github.com/evoactivity/vite-ember-ssr/issues/4
 */
function bundleAllDeps(userConfig: UserConfig): {
  ssr: { noExternal: [RegExp] };
} {
  if (userConfig.ssr) {
    delete userConfig.ssr.external;
  }
  return { ssr: { noExternal: [/./] } };
}

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
}

/**
 * Vite plugin that configures SSR support for Ember applications.
 *
 * Handles all SSR-related Vite configuration automatically:
 *
 * - Bundles all dependencies into SSR builds (`ssr.noExternal: [/./]`)
 *   to avoid runtime resolution failures under pnpm's strict
 *   node_modules layout (see issue #4)
 * - Sets build defaults: `dist/client` for client builds,
 *   `dist/server` with `target: 'node22'` for SSR builds
 * - Writes a `package.json` with `"type": "module"` to the SSR
 *   build output directory (needed for Node ESM compatibility)
 */
export function emberSsr(options: EmberSsrPluginOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'vite-ember-ssr',

    config(userConfig, env): UserConfig {
      // Bundle all dependencies for SSR builds to avoid runtime failures
      // under pnpm's strict node_modules layout when external packages
      // transitively import virtual Ember/Glimmer packages (e.g.
      // @glimmer/tracking) that only exist inside ember-source.
      // This is safe to set unconditionally — ssr.noExternal is ignored
      // for client builds, and SSR bundles run server-side where bundle
      // size is not a user-facing concern.
      // See: https://github.com/evoactivity/vite-ember-ssr/issues/4
      const ssrConfig = bundleAllDeps(userConfig);

      // During the SSG child build, only set ssr config — don't
      // override build.outDir (the SSG plugin sets it explicitly
      // via inline config to a temp directory).
      if (process.env.__VITE_EMBER_SSG_CHILD__) {
        return ssrConfig;
      }

      if (env.isSsrBuild) {
        return {
          ...ssrConfig,
          build: {
            outDir: options.serverOutDir ?? 'dist/server',
            target: 'node22',
            sourcemap: true,
            minify: false,
          },
        };
      }

      return {
        ...ssrConfig,
        build: {
          outDir: options.clientOutDir ?? 'dist/client',
        },
      };
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    generateBundle(_outputOptions, bundle) {
      // Only generate the CSS manifest for client builds.
      // SSR builds strip CSS imports, so they have nothing to map.
      if (resolvedConfig.build.ssr) return;

      // Don't generate during the SSG child build (it's an SSR build)
      if (process.env.__VITE_EMBER_SSG_CHILD__) return;

      const base = resolvedConfig.base ?? '/';
      const root = resolvedConfig.root;
      const manifest = buildCssManifest(bundle, base, root);

      // Only emit the manifest if there are dynamic entries with CSS.
      // Apps without lazy-loaded CSS don't need this file.
      if (Object.keys(manifest).length === 0) return;

      this.emitFile({
        type: 'asset',
        fileName: CSS_MANIFEST_FILENAME,
        source: JSON.stringify(manifest, null, 2),
      });
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
 * All dependencies are bundled into the SSR output (no externals) to
 * avoid runtime resolution failures under pnpm's strict node_modules
 * layout. See issue #4.
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
  } = options;

  // Track whether the user explicitly provided outDir
  const explicitOutDir = options.outDir;

  let resolvedConfig: ResolvedConfig;

  // Whether emberSsr is also registered — detected in config() hook
  let isCombined = false;

  return {
    name: 'vite-ember-ssg',

    config(userConfig): UserConfig {
      // Bundle all dependencies for SSR builds — see bundleAllDeps().
      const ssrConfig = bundleAllDeps(userConfig);

      // During the SSG child build, only set ssr config — don't touch
      // build.outDir or detect isCombined (irrelevant for child build).
      if (process.env.__VITE_EMBER_SSG_CHILD__) {
        return ssrConfig;
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
        ...ssrConfig,
        ...(outDir != null ? { build: { outDir } } : {}),
      };
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    generateBundle(_outputOptions, bundle) {
      // When combined with emberSsr, the SSR plugin already emits
      // the CSS manifest — skip to avoid duplicate emission.
      if (isCombined) return;

      // Only generate the CSS manifest for client builds.
      if (resolvedConfig.build.ssr) return;

      // Don't generate during the SSG child build (it's an SSR build)
      if (process.env.__VITE_EMBER_SSG_CHILD__) return;

      const base = resolvedConfig.base ?? '/';
      const root = resolvedConfig.root;
      const manifest = buildCssManifest(bundle, base, root);

      if (Object.keys(manifest).length === 0) return;

      this.emitFile({
        type: 'asset',
        fileName: CSS_MANIFEST_FILENAME,
        source: JSON.stringify(manifest, null, 2),
      });
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

      // Read the CSS manifest (if it exists) so we can inject
      // lazy-loaded CSS into prerendered pages.
      let cssManifest: CssManifest | undefined;
      const cssManifestPath = join(clientDir, CSS_MANIFEST_FILENAME);
      try {
        const raw = await readFile(cssManifestPath, 'utf-8');
        cssManifest = JSON.parse(raw) as CssManifest;
      } catch {
        // No CSS manifest — app has no lazy-loaded CSS
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
            // Belt-and-suspenders: the config hooks already call
            // bundleAllDeps() for the child build, but setting it here
            // in inline config guarantees it even if the user's config
            // file doesn't register the SSR/SSG plugins for some reason.
            noExternal: [/./],
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

        // Prerender each route — each render runs in a fresh Worker thread,
        // so the SSR bundle is imported clean every time with no shared
        // prototype-patch or module-level singleton state across renders.
        for (const route of routes) {
          const url = route === 'index' ? '/' : `/${route}`;

          try {
            const result = await render({
              url,
              template,
              ssrBundlePath: ssrBundleURL,
              shoebox,
              rehydrate,
              cssManifest,
            });

            if (result.error) {
              console.error(
                `  [vite-ember-ssg] Error rendering ${url}:\n` +
                  (result.error.stack ?? result.error.message),
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
              `  [vite-ember-ssg] Failed to prerender ${url}:\n` +
                (e instanceof Error ? (e.stack ?? e.message) : String(e)),
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
