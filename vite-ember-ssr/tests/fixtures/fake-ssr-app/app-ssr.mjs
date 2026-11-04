/**
 * A stand-in for an app's SSR bundle, for tests of the renderer itself (the
 * worker pool, dev mode, assembly) that don't need Ember: `visit()` writes
 * to the document it is given, as an Ember app rendering would.
 *
 *   /html-attrs     sets attributes on <html>
 *   /throw-later    throws from a timer while the page renders
 *   /reject-later   leaves a rejected promise unhandled while it renders
 *   anything else   renders a paragraph with the URL
 *
 * Every page says how many visits this copy of the bundle has rendered, so a
 * test can tell a warm worker from a new one.
 */
let visits = 0;

export function createSsrApp() {
  return {
    async visit(url, { document }) {
      visits++;

      if (url === '/html-attrs') {
        document.documentElement.setAttribute('lang', 'es-MX');
        document.documentElement.setAttribute('dir', 'ltr');
      }

      if (url === '/throw-later') {
        setTimeout(() => {
          throw new Error('thrown from a timer during the render');
        }, 0);
      }

      if (url === '/reject-later') {
        Promise.reject(new Error('rejected during the render'));
      }

      const p = document.createElement('p');
      p.textContent = `rendered ${url}, visit ${visits}`;
      document.body.appendChild(p);

      return { destroy() {}, lookup() {} };
    },
  };
}

// Long enough for the timers above to fire before the DOM is read.
export async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
