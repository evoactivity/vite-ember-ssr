import { Window } from 'happy-dom';

const SSR_HEAD_MARKER = '<!-- VITE_EMBER_SSR_HEAD -->';
const SSR_BODY_MARKER = '<!-- VITE_EMBER_SSR_BODY -->';
const SSR_MARKER_REGEX = /<!-- VITE_EMBER_SSR_(HEAD|BODY) -->/g;

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Minimal interface for an Ember Application that supports SSR.
 *
 * The app must be created with `autoboot: false` so the server can
 * control boot timing via `app.visit(url, options)`.
 *
 * `visit()` handles the full boot sequence internally:
 *   app.boot() → app.buildInstance() → instance.boot(options) → instance.visit(url)
 * and returns a Promise<ApplicationInstance>.
 */
export interface EmberApplication {
  visit(url: string, options?: BootOptions): Promise<EmberApplicationInstance>;
  destroy(): void;
}

export interface EmberApplicationInstance {
  destroy(): void;
  getURL?(): string;
  _booted?: boolean;
}

export interface BootOptions {
  /** When false, disables browser-specific features like event delegation. */
  isBrowser: boolean;
  /** The document to render into. For SSR, this is the HappyDOM document. */
  document: Document;
  /** The root DOM element for the Ember app. Typically document.body. */
  rootElement: Element;
  /** Whether Ember should render templates. Set to true for SSR. */
  shouldRender: boolean;
  /** Override the router's location type. */
  location?: string;
}

export interface RenderOptions {
  /** The URL path to render, e.g., '/' or '/about' */
  url: string;

  /**
   * Factory function that creates a fresh Ember Application instance.
   * This should be the `createSsrApp` export from the Ember app.
   */
  createApp: () => EmberApplication;
}

export interface RenderResult {
  /** Rendered HTML from the document's <head> */
  head: string;
  /** Rendered HTML from the document's <body>, wrapped in boundary markers */
  body: string;
  /** HTTP status code (200 by default) */
  statusCode: number;
  /** Any error that occurred during rendering */
  error?: Error;
}

// ─── HappyDOM Environment ────────────────────────────────────────────

/**
 * Creates an isolated HappyDOM Window for a single SSR request.
 * Each request gets its own Window to prevent state leakage.
 */
function createSSRWindow(url: string): Window {
  return new Window({
    url: `http://localhost${url}`,
    width: 1024,
    height: 768,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      navigator: {
        userAgent: 'vite-ember-ssr',
      },
    },
  });
}

/**
 * Browser global names that Ember (and its dependencies) reference
 * during rendering. We temporarily copy these from the per-request
 * HappyDOM Window onto globalThis for the duration of the render,
 * then restore the originals.
 */
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
] as const;

/**
 * Temporarily installs HappyDOM's browser globals onto globalThis
 * for the duration of a callback. Restores the originals afterward.
 */
async function withBrowserGlobals<T>(
  window: Window,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  // Install globals
  for (const name of BROWSER_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = (window as unknown as Record<string, unknown>)[name];
    try {
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      // Some globals may not be overridable
    }
  }

  try {
    return await fn();
  } finally {
    // Restore originals
    for (const name of BROWSER_GLOBALS) {
      const desc = saved.get(name);
      if (desc) {
        try {
          Object.defineProperty(globalThis, name, desc);
        } catch {
          // ignore
        }
      } else {
        try {
          delete (globalThis as Record<string, unknown>)[name];
        } catch {
          // ignore
        }
      }
    }
  }
}

// ─── Core Rendering ──────────────────────────────────────────────────

/**
 * Renders an Ember application at the given URL using HappyDOM.
 *
 * This is the main SSR entry point. It:
 * 1. Creates an isolated HappyDOM Window
 * 2. Temporarily installs browser globals from HappyDOM
 * 3. Creates the Ember app and calls visit()
 * 4. Extracts the rendered HTML
 * 5. Cleans up all resources
 *
 * Each call creates a completely fresh environment — there is no
 * shared state between requests.
 */
export async function renderEmberApp(options: RenderOptions): Promise<RenderResult> {
  const { url, createApp } = options;

  const window = createSSRWindow(url);
  const document = window.document as unknown as Document;

  let app: EmberApplication | undefined;
  let instance: EmberApplicationInstance | undefined;
  let error: Error | undefined;

  try {
    await withBrowserGlobals(window, async () => {
      // Create a fresh Ember application (autoboot must be false)
      app = createApp();

      // Application#visit() handles the full boot sequence:
      //   app.boot() → app.buildInstance() → instance.boot(options) → instance.visit(url)
      const bootOptions: BootOptions = {
        isBrowser: false,
        document,
        rootElement: document.body as unknown as Element,
        shouldRender: true,
      };

      instance = await app.visit(url, bootOptions);
    });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  // Extract rendered HTML before cleanup
  const head = document.head?.innerHTML ?? '';
  const body = document.body?.innerHTML ?? '';

  // Wrap body in boundary markers so the client can identify SSR content
  const wrappedBody = [
    '<script type="x/boundary" id="ssr-body-start"></script>',
    body,
    '<script type="x/boundary" id="ssr-body-end"></script>',
  ].join('');

  // Cleanup: destroy in reverse order
  try {
    instance?.destroy();
  } catch {
    // Instance may already be destroyed if an error occurred during visit
  }

  try {
    app?.destroy();
  } catch {
    // Application may already be destroyed
  }

  // Close HappyDOM window to free resources
  await window.happyDOM.close();

  return {
    head,
    body: wrappedBody,
    statusCode: error ? 500 : 200,
    error,
  };
}

// ─── HTML Assembly ───────────────────────────────────────────────────

/**
 * Assembles the final HTML response by inserting rendered content
 * into the index.html template.
 *
 * Replaces:
 * - `<!-- VITE_EMBER_SSR_HEAD -->` with the rendered head content
 * - `<!-- VITE_EMBER_SSR_BODY -->` with the rendered body content
 */
export function assembleHTML(
  template: string,
  rendered: Pick<RenderResult, 'head' | 'body'>,
): string {
  let headReplaced = false;
  let bodyReplaced = false;

  return template.replace(SSR_MARKER_REGEX, (_match, tag: string) => {
    if (tag === 'HEAD' && !headReplaced) {
      headReplaced = true;
      return rendered.head;
    }
    if (tag === 'BODY' && !bodyReplaced) {
      bodyReplaced = true;
      return rendered.body;
    }
    return '';
  });
}

/**
 * Checks whether an HTML template contains the required SSR markers.
 */
export function hasSSRMarkers(html: string): { head: boolean; body: boolean } {
  return {
    head: html.includes(SSR_HEAD_MARKER),
    body: html.includes(SSR_BODY_MARKER),
  };
}
