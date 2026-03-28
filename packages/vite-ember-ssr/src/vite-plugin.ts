import type { Plugin, ResolvedConfig } from 'vite';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
export const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';

export interface EmberSsrPluginOptions {
  /**
   * The Ember app's module prefix (e.g., 'test-app').
   * Used for config meta tag identification.
   */
  appName?: string;
}

/**
 * Vite plugin that configures SSR support for Ember applications.
 *
 * When used in the SSR vite config, this plugin:
 * - Writes a package.json with "type": "module" to the output directory
 *   (needed for Node ESM compatibility)
 * - Provides the SSR marker constants for HTML template processing
 */
export function emberSsr(options: EmberSsrPluginOptions = {}): Plugin[] {
  return [
    packageJsonPlugin(),
  ];
}

/**
 * Writes a package.json with "type": "module" to the SSR build output
 * directory. This is necessary because Node.js needs to know that the
 * output files are ES modules.
 */
function packageJsonPlugin(): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'vite-ember-ssr:package-json',
    apply: 'build',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    async closeBundle() {
      const outDir = join(config.root, config.build.outDir);
      const targetPath = join(outDir, 'package.json');
      await mkdir(outDir, { recursive: true });
      await writeFile(targetPath, JSON.stringify({ type: 'module' }, null, 2), 'utf-8');
    },
  };
}

export default emberSsr;
