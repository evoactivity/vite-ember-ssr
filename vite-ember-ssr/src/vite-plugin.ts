import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from 'vite';
import { join, dirname, relative, sep } from 'node:path';
import MagicString from 'magic-string';
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
  access,
} from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';

export const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
export const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';

/**
 * Name of the CSS manifest file generated during the client build.
 * Maps dynamic entry source modules to their associated CSS asset paths.
 */
export const CSS_MANIFEST_FILENAME = 'css-manifest.json';

/**
 * The CSS manifest maps each dynamically imported module
 * to the CSS files Vite extracted for its chunk in the client build.
 *
 * Keys are module paths relative to the Vite root:
 *
 *   "app/templates/about.gts" → ["/assets/about-VWk4xp3e.css"]
 *
 * During SSR, every `import()` the app performs while it renders a URL
 * is recorded. See `trackDynamicImports`.
 *
 * The recorded modules are looked up here,
 * and their CSS is injected as `<link>` tags.
 */
export type CssManifest = Record<string, string[]>;

/**
 * Name of the global that SSR-transformed `import()` calls invoke
 * with the module path, before the import runs.
 */
export const IMPORT_HOOK_GLOBAL = '__vite_ember_ssr_import__';

/**
 * Converts an absolute module id into the manifest key.
 *
 * - relative to the Vite root
 * - posix separators
 * - no query string
 */
function sourceModuleId(id: string, root: string): string {
  const clean = id.split('?')[0];
  return relative(root, clean).split(sep).join('/');
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
 * Keys are the source module paths of the dynamic entries,
 * relative to the Vite root.
 *
 * The SSR side records the same paths when the app calls `import()`.
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

    // Without a facade module there is no source path to key on
    if (!chunk.facadeModuleId) continue;

    // Prefix CSS paths with the base URL so they work as href values.
    const cssFiles = Array.from(css).map((c) => `${base}${c}`);

    manifest[sourceModuleId(chunk.facadeModuleId, root)] = cssFiles;
  }

  return manifest;
}

// ─── SSR import tracking ─────────────────────────────────────────────

interface AstNode {
  type: string;
  start?: number;
  end?: number;
  range?: [number, number];
  [key: string]: unknown;
}

function nodeSpan(node: AstNode): [number, number] | undefined {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return [node.start, node.end];
  }
  return node.range;
}

/**
 * The specifier of an `import()` expression when it is a plain string.
 *
 * Computed specifiers give undefined.
 */
function literalSpecifier(source: AstNode): string | undefined {
  if (source.type === 'Literal' && typeof source.value === 'string') {
    return source.value;
  }
  if (source.type === 'TemplateLiteral') {
    const expressions = source.expressions as unknown[];
    const quasis = source.quasis as Array<{ value: { cooked?: string } }>;
    if (expressions.length === 0 && quasis.length === 1) {
      return quasis[0].value.cooked;
    }
  }
  return undefined;
}

function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const candidate = node as AstNode;
  if (typeof candidate.type === 'string') visit(candidate);
  for (const key of Object.keys(candidate)) {
    if (key === 'loc' || key === 'range') continue;
    walk(candidate[key], visit);
  }
}

/**
 * Reports every `import()` the app's own modules perform in SSR.
 *
 * Each `import()` is prefixed with a call to the
 * `__vite_ember_ssr_import__` global, passing the module's path
 * relative to the Vite root:
 *
 *   import("./about.gts")
 *   → (globalThis.__vite_ember_ssr_import__?.("app/templates/about.gts"), import("./about.gts"))
 *
 * The renderer installs that global while it renders a URL
 * and collects the paths. See css-links.ts.
 *
 * Only SSR transforms are touched.
 *
 * Runs as a `post` transform, after `import.meta.glob` and TypeScript
 * are compiled down to plain `import()` expressions.
 */
export function trackDynamicImports(): Plugin {
  let root = '';
  let active = true;

  const plugin: Plugin = {
    name: 'vite-ember-ssr:track-imports',
    enforce: 'post',

    configResolved(config) {
      root = config.root;
      // emberSsr() and emberSsg() each register this plugin.
      // Only the first copy transforms, so imports are wrapped once.
      const first = config.plugins.find((p) => p.name === plugin.name);
      active = first === plugin;
    },

    async transform(code, id, options) {
      if (!active || !options?.ssr) return null;
      if (id.startsWith('\0') || !id.startsWith(root)) return null;
      if (id.includes('/node_modules/')) return null;
      if (!code.includes('import(')) return null;

      const ast = this.parse(code) as unknown as AstNode;
      const imports: Array<{ span: [number, number]; specifier: string }> = [];

      walk(ast, (node) => {
        if (node.type !== 'ImportExpression') return;
        const specifier = literalSpecifier(node.source as AstNode);
        const span = nodeSpan(node);
        if (specifier && span) imports.push({ span, specifier });
      });

      if (imports.length === 0) return null;

      const s = new MagicString(code);
      let changed = false;

      for (const { span, specifier } of imports) {
        const resolved = await this.resolve(specifier, id);
        if (!resolved || resolved.external || resolved.id.startsWith('\0')) {
          continue;
        }

        const key = JSON.stringify(sourceModuleId(resolved.id, root));
        s.prependLeft(span[0], `(globalThis.${IMPORT_HOOK_GLOBAL}?.(${key}), `);
        s.appendRight(span[1], ')');
        changed = true;
      }

      if (!changed) return null;

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };

  return plugin;
}

/**
 * Returns SSR config appropriate for the current Vite command.
 *
 * Ember's virtual packages (`@glimmer/tracking`, `@ember/*`, etc.) are
 * provided by `ember-source` and not published as real npm packages.
 * When Vite externalizes a dependency that transitively imports one of
 * these virtual packages, Node's runtime module resolution fails under
 * pnpm's strict `node_modules` layout.
 *
 * For both production builds and dev mode:
 *   - Clears any user-specified `ssr.external` (explicit string entries
 *     take precedence over `noExternal` patterns in Vite, so we must
 *     remove them to ensure `noExternal: [/./]` applies).
 *   - Sets `ssr: { noExternal: [/./] }` so all deps go through Vite's
 *     transform pipeline. This lets `@embroider/vite`'s resolver handle
 *     virtual Ember/Glimmer packages that don't exist outside `ember-source`
 *     under pnpm's strict `node_modules` layout.
 *
 * In dev mode, `ssrLoadModule` uses `SSRCompatModuleRunner` +
 * `ESModulesEvaluator`. Without bundling, this evaluates all module code
 * inline. CJS/UMD packages (e.g. `@warp-drive/utilities/string`,
 * `json-to-ast`) reference `module`, `exports`, or `global` which are not
 * available in the evaluator's context.
 *
 * The `cjsSsrShimTransform` hook (applied by `emberSsr()` and `emberSsg()`)
 * intercepts those files before they reach `ssrTransform` and wraps them
 * with a lightweight CommonJS shim, providing the missing `module`,
 * `exports`, and `global` bindings.
 *
 * See: https://github.com/evoactivity/vite-ember-ssr/issues/4
 */
function ssrDepsConfig(
  userConfig: UserConfig,
  _command: 'build' | 'serve',
): { ssr?: UserConfig['ssr'] } {
  if (userConfig.ssr) {
    delete userConfig.ssr.external;
  }
  return { ssr: { noExternal: [/./] } };
}

/**
 * Returns a Vite `transform` hook that wraps CJS/UMD modules encountered
 * during SSR transforms.
 *
 * When `noExternal: [/./]` is set, every dependency goes through Vite's
 * `ssrTransform` → `ESModulesEvaluator` pipeline. CJS/UMD files that use
 * `module`, `exports`, or `global` fail because those globals are not
 * available inside `ESModulesEvaluator`'s `AsyncFunction` context.
 *
 * This transform detects CJS/UMD content (no top-level `import`/`export`
 * statements, but contains `exports.xxx` or `module.exports`) and wraps
 * the code so that:
 *   1. `module`, `exports`, and `global` are available as local variables.
 *   2. The module's exports are re-exported as the ES default export.
 *
 * The heuristic is intentionally simple and conservative — it only fires
 * on files that have no ESM syntax at all, which covers the CJS/UMD
 * packages that appear in the Ember + WarpDrive dependency tree without
 * misidentifying genuine ESM files.
 */
function cjsSsrShimTransform(
  code: string,
  _id: string,
  options?: { ssr?: boolean },
): { code: string; map: null } | null {
  // Only apply during SSR transforms
  if (!options?.ssr) return null;

  // Skip if the file contains any top-level import/export → it's ESM
  if (/^(?:import\s|export\s|export\{|export default)/m.test(code)) return null;

  // Only wrap files that use CommonJS exports or module.exports
  if (!/\bexports\s*[.[=]|\bmodule\s*\.\s*exports\b/.test(code)) return null;

  const wrapped = `\
const __cjs_module__ = { exports: {} };
const __cjs_exports__ = __cjs_module__.exports;
const __cjs_global__ = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : {};
(function(module, exports, global) {
${code}
})(__cjs_module__, __cjs_exports__, __cjs_global__);
export default __cjs_module__.exports;
`;
  return { code: wrapped, map: null };
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
export function emberSsr(options: EmberSsrPluginOptions = {}): Plugin[] {
  let resolvedConfig: ResolvedConfig;

  const plugin: Plugin = {
    name: 'vite-ember-ssr',

    config(userConfig, env): UserConfig {
      // Bundle all dependencies for SSR builds and dev mode to avoid runtime
      // failures under pnpm's strict node_modules layout when external packages
      // transitively import virtual Ember/Glimmer packages (e.g.
      // @glimmer/tracking) that only exist inside ember-source.
      // In dev mode, the `transform: cjsSsrShimTransform` hook wraps
      // CJS/UMD packages so they work with ESModulesEvaluator.
      // See: https://github.com/evoactivity/vite-ember-ssr/issues/4
      const ssrConfig = ssrDepsConfig(userConfig, env.command);

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

    transform: cjsSsrShimTransform,

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

  return [plugin, trackDynamicImports()];
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
export function emberSsg(options: EmberSsgPluginOptions): Plugin[] {
  const { routes, ssrEntry = 'app/app-ssr.ts', shoebox = false } = options;

  // Track whether the user explicitly provided outDir
  const explicitOutDir = options.outDir;

  let resolvedConfig: ResolvedConfig;

  // Whether emberSsr is also registered — detected in config() hook
  let isCombined = false;

  const plugin: Plugin = {
    name: 'vite-ember-ssg',

    config(userConfig, env): UserConfig {
      // Bundle all dependencies for SSR builds — see ssrDepsConfig().
      const ssrConfig = ssrDepsConfig(userConfig, env.command);

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

    transform: cjsSsrShimTransform,

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
      const { assembleHTML, createEmberApp } = await import('./server.js');

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
            // ssrDepsConfig() for the child build, but setting it here
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

        // Prerender all routes in parallel using a long-lived worker pool.
        // Workers import the SSR bundle once and reuse it across renders,
        // making per-render cost ~4ms vs ~200ms for a fresh-worker approach.
        const app = await createEmberApp(ssrBundleURL, {
          workers: cpus().length,
        });

        try {
          await Promise.all(
            routes.map(async (route) => {
              const url = route === 'index' ? '/' : `/${route}`;

              try {
                const result = await app.renderRoute(url, {
                  shoebox,
                  cssManifest,
                });

                if (result.error) {
                  console.error(
                    `  [vite-ember-ssg] Error rendering ${url}:\n` +
                      (result.error.stack ?? result.error.message),
                  );
                  errorCount++;
                  return;
                }

                const html = assembleHTML(template, result);

                // 'index' → index.html (overwrite the shell)
                // 'about' → about/index.html
                // 'pokemon/charmander' → pokemon/charmander/index.html
                const outputPath =
                  route === 'index'
                    ? join(clientDir, 'index.html')
                    : join(clientDir, route, 'index.html');

                await mkdir(dirname(outputPath), { recursive: true });
                await writeFile(outputPath, html, 'utf-8');

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
            }),
          );
        } finally {
          await app.destroy();
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

  return [plugin, trackDynamicImports()];
}

export default emberSsr;
