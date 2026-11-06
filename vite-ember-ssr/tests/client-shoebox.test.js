// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { installShoebox, cleanupShoebox } from '../src/client.ts';

const SHOEBOX_SCRIPT_ID = 'vite-ember-ssr-shoebox';

function addShoeboxScript() {
  const script = document.createElement('script');
  script.id = SHOEBOX_SCRIPT_ID;
  script.textContent = JSON.stringify([
    {
      url: 'https://api.example.com/x',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
    },
  ]);
  document.body.appendChild(script);
}

afterEach(() => {
  cleanupShoebox();
  vi.unstubAllEnvs();
  document.getElementById(SHOEBOX_SCRIPT_ID)?.remove();
});

describe('shoebox fetch interceptor native-fetch transparency', () => {
  it('reports the native fetch source in dev so detection sees through the wrapper', () => {
    const nativeSource = globalThis.fetch.toString();
    addShoeboxScript();

    expect(installShoebox()).toBe(true);

    // The interceptor is installed (a distinct wrapper) but must be
    // indistinguishable from native fetch to libraries that sniff toString().
    expect(globalThis.fetch.name).toBe('shoeboxFetch');
    expect(globalThis.fetch.toString()).toBe(nativeSource);

    // Restoring puts the real fetch back.
    cleanupShoebox();
    expect(globalThis.fetch.toString()).toBe(nativeSource);
  });

  it('leaves the wrapper source untouched outside dev', () => {
    vi.stubEnv('DEV', false);
    const nativeSource = globalThis.fetch.toString();
    addShoeboxScript();

    expect(installShoebox()).toBe(true);

    // No override in production: the wrapper reports its own source. That is
    // fine because the libraries that sniff fetch only do so in dev builds.
    expect(globalThis.fetch.name).toBe('shoeboxFetch');
    expect(globalThis.fetch.toString()).not.toBe(nativeSource);
  });
});
