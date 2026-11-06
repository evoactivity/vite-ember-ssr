/**
 * Records which modules the app imports while it renders a URL.
 * Turns those into `<link>` tags through the CSS manifest.
 *
 * In SSR builds, every `import()` in the app first calls
 * the `__vite_ember_ssr_import__` global with the module's path.
 * See `trackDynamicImports` in vite-plugin.ts.
 *
 * The global is installed once per process.
 * It appends to the set of the render in progress.
 *
 * One module-level set holds that render's imports.
 * `AsyncLocalStorage` cannot: Backburner and RSVP create their queues
 * once at startup, so a render's async context never reaches the `import()`.
 * Renders are serialised per worker, so one set is enough.
 */

import { IMPORT_HOOK_GLOBAL, type CssManifest } from './vite-plugin.js';

let current: Set<string> | null = null;
let installed = false;

function installImportHook(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(globalThis, IMPORT_HOOK_GLOBAL, {
    value: (id: string) => {
      current?.add(id);
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Starts recording the module paths the app imports.
 *
 * Returns the set that the import hook appends to
 * until `stopImportTracking()` is called.
 */
export function startImportTracking(): Set<string> {
  installImportHook();
  current = new Set<string>();
  return current;
}

export function stopImportTracking(): void {
  current = null;
}

/**
 * Builds a stylesheet link for every tracked import in the manifest.
 *
 * - in import order
 * - each href once
 */
export function buildCssLinks(
  manifest: CssManifest | null | undefined,
  imports: Iterable<string>,
): string {
  if (!manifest) return '';
  const seen = new Set<string>();
  const links: string[] = [];
  for (const id of imports) {
    const cssFiles = manifest[id];
    if (!cssFiles) continue;
    for (const href of cssFiles) {
      if (seen.has(href)) continue;
      seen.add(href);
      links.push(`<link rel="stylesheet" href="${href}">`);
    }
  }
  return links.join('');
}
