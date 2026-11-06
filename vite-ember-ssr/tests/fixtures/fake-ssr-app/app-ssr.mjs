/**
 * A stand-in for an app's SSR bundle, for tests of the renderer itself (the
 * worker pool, dev mode, assembly) that don't need Ember: `visit()` writes
 * to the document it is given, as an Ember app rendering would.
 *
 *   /html-attrs   sets attributes on <html>
 *   anything else renders a paragraph with the URL
 */
export function createSsrApp() {
  return {
    async visit(url, { document }) {
      if (url === '/html-attrs') {
        document.documentElement.setAttribute('lang', 'es-MX');
        document.documentElement.setAttribute('dir', 'ltr');
      }

      const p = document.createElement('p');
      p.textContent = `rendered ${url}`;
      document.body.appendChild(p);

      return { destroy() {}, lookup() {} };
    },
  };
}

export async function settled() {}
