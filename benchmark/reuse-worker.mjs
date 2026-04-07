/**
 * Isolation test worker — accepts repeated render requests on the same
 * V8 isolate to test whether Ember state bleeds between renders.
 */
import { workerData, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(
  resolve(__dirname, '../packages/vite-ember-ssr/package.json'),
);
const { Window } = req('happy-dom');

const { ssrBundlePath } = workerData;

const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'self',
  'localStorage',
  'sessionStorage',
  'InputEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'PointerEvent',
  'IntersectionObserver',
  'ResizeObserver',
  'CSSStyleSheet',
];

const ssrModule = await import(ssrBundlePath);
let renderCount = 0;

parentPort.on('message', async ({ url, id }) => {
  renderCount++;
  const win = new Window({
    url: 'http://localhost' + url,
    width: 1024,
    height: 768,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      navigator: { userAgent: 'bench' },
    },
  });

  for (const name of BROWSER_GLOBALS) {
    try {
      Object.defineProperty(globalThis, name, {
        value: win[name],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {}
  }

  try {
    const app = await ssrModule.createSsrApp();
    const instance = await app.visit(url, {
      isBrowser: false,
      document: win.document,
      rootElement: win.document.body,
      shouldRender: true,
    });
    await new Promise((r) => setTimeout(r, 0));
    const body = win.document.body?.innerHTML ?? '';
    parentPort.postMessage({ id, body, renderCount, ok: true });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message, renderCount, ok: false });
  }
});
