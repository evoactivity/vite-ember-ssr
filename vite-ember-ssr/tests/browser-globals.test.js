import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import {
  browserGlobalNames,
  installGlobals,
  restoreGlobals,
} from '../src/browser-globals.ts';

describe('browserGlobalNames', () => {
  const names = browserGlobalNames(new Window());

  it('has the names that code reads from the global scope', () => {
    expect(names).toEqual(
      expect.arrayContaining(['window', 'document', 'requestAnimationFrame']),
    );
  });

  it('has every class of DOM node', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'Node',
        'Text',
        'Comment',
        'DocumentFragment',
        'ShadowRoot',
        'HTMLElement',
        'HTMLScriptElement',
        'SVGElement',
      ]),
    );
  });

  it('has no class that is not a DOM node', () => {
    expect(names).not.toContain('XMLHttpRequest');
    expect(names).not.toContain('WebSocket');
    expect(names).not.toContain('Headers');
  });

  it('has each name one time', () => {
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('installGlobals', () => {
  it('installs the globals of the window, and restoreGlobals puts the old values back', () => {
    const win = new Window();

    expect(globalThis.Text).toBeUndefined();

    const before = globalThis.navigator;
    const saved = installGlobals(win);

    expect(globalThis.Text).toBe(win.Text);
    expect(globalThis.ShadowRoot).toBe(win.ShadowRoot);
    expect(globalThis.document).toBe(win.document);
    expect(globalThis.navigator).toBe(win.navigator);

    restoreGlobals(saved);

    expect(globalThis.Text).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
    expect(globalThis.navigator).toBe(before);
  });
});
