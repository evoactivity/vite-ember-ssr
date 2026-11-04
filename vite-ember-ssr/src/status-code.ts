/**
 * The HTTP status code of a render, set by the app while it renders.
 *
 * The code lives on `globalThis`, not in a module variable: the SSR bundle
 * can carry its own copy of `vite-ember-ssr/client`, and the renderer must
 * see what that copy wrote. The worker renders one page at a time, and dev
 * mode installs new globals for each render, so renders never share it.
 */
const KEY = Symbol.for('vite-ember-ssr.statusCode');

type WithStatusCode = typeof globalThis & { [KEY]?: number };

/**
 * Sets the HTTP status code of the page that is rendering on the server,
 * for example `setStatusCode(404)` in a not-found route.
 *
 * `renderRoute()` returns it as `statusCode`. A render error still answers
 * 500. In the browser, the code has no effect.
 */
export function setStatusCode(code: number): void {
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    throw new RangeError(
      `[vite-ember-ssr] setStatusCode() needs an HTTP status code from 100 to 599, but got ${String(code)}`,
    );
  }

  (globalThis as WithStatusCode)[KEY] = code;
}

/**
 * Clears the code, so that a render does not get the code of the one before.
 */
export function resetStatusCode(): void {
  delete (globalThis as WithStatusCode)[KEY];
}

/**
 * The status code of a finished render.
 *
 * A URL that no route matches answers 404, because `visit()` throws
 * `UnrecognizedURLError` for it. Any other error answers 500.
 */
export function statusCodeFor(error: Error | undefined): number {
  if (error) return error.name === 'UnrecognizedURLError' ? 404 : 500;

  return (globalThis as WithStatusCode)[KEY] ?? 200;
}
