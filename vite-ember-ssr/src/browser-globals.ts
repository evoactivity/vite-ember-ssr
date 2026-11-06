import type { Window } from 'happy-dom';

type Globals = Record<string, unknown>;

/**
 * The names that code reads from the global scope, where a browser has them.
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
  'getComputedStyle',
] as const;

/**
 * Every class of DOM node that the window has: `Text`, `Comment`,
 * `DocumentFragment`, `ShadowRoot`, and each `HTML*Element` and `SVG*Element`.
 *
 * Code uses these as bare names (`node instanceof Text`), so a fixed list
 * always misses one. Only node classes are taken: a name such as
 * `XMLHttpRequest` would change how a library picks its transport.
 */
function nodeClassNames(win: Window): string[] {
  const source = win as unknown as Globals;
  const NodeClass = source['Node'] as { prototype: object } | undefined;
  const names = new Set<string>();

  if (!NodeClass) return [];

  for (
    let object: object | null = win;
    object && object !== Object.prototype;
    object = Object.getPrototypeOf(object) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(object)) {
      if (!/^[A-Z]/.test(name)) continue;

      let value: unknown;

      try {
        value = source[name];
      } catch {
        continue;
      }

      if (typeof value !== 'function') continue;

      const prototype = (value as { prototype?: unknown }).prototype;

      if (
        value === NodeClass ||
        (prototype instanceof Object &&
          Object.prototype.isPrototypeOf.call(NodeClass.prototype, prototype))
      ) {
        names.add(name);
      }
    }
  }

  return Array.from(names);
}

/**
 * The names that `installGlobals` puts on `globalThis` for this window.
 */
export function browserGlobalNames(win: Window): string[] {
  const names = new Set<string>(BROWSER_GLOBALS);

  for (const name of nodeClassNames(win)) {
    names.add(name);
  }

  return Array.from(names);
}

/**
 * Puts the browser globals of the window on `globalThis`.
 * Returns what was there before, for `restoreGlobals`.
 */
export function installGlobals(win: Window): Globals {
  const source = win as unknown as Globals;
  const saved: Globals = {};

  for (const name of browserGlobalNames(win)) {
    saved[name] = (globalThis as Globals)[name];

    try {
      Object.defineProperty(globalThis, name, {
        value: source[name],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      /* skip non-overridable globals */
    }
  }

  return saved;
}

export function restoreGlobals(saved: Globals): void {
  for (const name of Object.keys(saved)) {
    try {
      Object.defineProperty(globalThis, name, {
        value: saved[name],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      /* skip */
    }
  }
}
