import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

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

      const outDir = join(resolvedConfig.root, resolvedConfig.build.outDir);
      const targetPath = join(outDir, 'package.json');
      await mkdir(outDir, { recursive: true });
      await writeFile(targetPath, JSON.stringify({ type: 'module' }, null, 2), 'utf-8');
    },
  };
}

export default emberSsr;
