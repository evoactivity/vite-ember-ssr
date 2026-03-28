/**
 * Client-side utilities for vite-ember-ssr.
 *
 * Currently the client Ember app boots normally and replaces the
 * SSR-rendered content. True DOM hydration is planned for a future
 * phase.
 *
 * For now, the SSR content provides the initial visual while client
 * JavaScript loads, parses, and Ember boots.
 */

/**
 * Removes the SSR-rendered content from the DOM before the client
 * Ember app boots. This prevents the "double render" where both the
 * server-rendered HTML and the client-rendered HTML are visible.
 *
 * Removes everything between (and including) the SSR boundary markers:
 *   <script type="x/boundary" id="ssr-body-start">
 *   ...server rendered content...
 *   <script type="x/boundary" id="ssr-body-end">
 *
 * Call this in your client entry point BEFORE creating the Ember app.
 */
export function cleanupSSRContent(): void {
  const start = document.getElementById('ssr-body-start');
  const end = document.getElementById('ssr-body-end');

  if (!start || !end) {
    return; // Not an SSR-rendered page
  }

  // Remove all nodes between start and end markers (inclusive)
  const parent = start.parentNode;
  if (!parent) return;

  let node: ChildNode | null = start;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    parent.removeChild(node);
    if (node === end) break;
    node = next;
  }
}

/**
 * Checks if the current page was server-side rendered by looking
 * for SSR boundary markers in the DOM.
 */
export function isSSRRendered(): boolean {
  return document.getElementById('ssr-body-start') !== null;
}
