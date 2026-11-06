import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCssLinks,
  startImportTracking,
  stopImportTracking,
} from '../src/css-links.ts';
import { IMPORT_HOOK_GLOBAL } from '../src/vite-plugin.ts';

// Calls the global the same way an SSR-transformed import() does
function reportImport(id) {
  globalThis[IMPORT_HOOK_GLOBAL]?.(id);
}

afterEach(() => {
  stopImportTracking();
});

describe('import tracking', () => {
  it('records the modules reported while tracking is active', () => {
    const imports = startImportTracking();
    reportImport('app/templates/about.gts');
    reportImport('app/components/lazy-chart.gts');

    expect([...imports]).toEqual([
      'app/templates/about.gts',
      'app/components/lazy-chart.gts',
    ]);
  });

  it('records nothing once tracking has stopped', () => {
    const imports = startImportTracking();
    stopImportTracking();
    reportImport('app/templates/about.gts');

    expect(imports.size).toBe(0);
  });

  it('starts each render with an empty set', () => {
    startImportTracking();
    reportImport('app/templates/about.gts');
    stopImportTracking();

    expect(startImportTracking().size).toBe(0);
  });
});

describe('buildCssLinks', () => {
  const manifest = {
    'app/templates/about.gts': ['/assets/about.css', '/assets/shared.css'],
    'app/components/lazy-chart.gts': ['/assets/lazy-chart.css'],
    'app/templates/contact.gts': ['/assets/shared.css'],
  };

  it('links each module in import order and each href once', () => {
    const links = buildCssLinks(manifest, [
      'app/templates/about.gts',
      'app/components/lazy-chart.gts',
      'app/templates/contact.gts',
    ]);

    expect(links).toBe(
      '<link rel="stylesheet" href="/assets/about.css">' +
        '<link rel="stylesheet" href="/assets/shared.css">' +
        '<link rel="stylesheet" href="/assets/lazy-chart.css">',
    );
  });

  it('skips modules that are not in the manifest', () => {
    expect(buildCssLinks(manifest, ['app/templates/index.gts'])).toBe('');
  });

  it('returns no links without a manifest', () => {
    expect(buildCssLinks(null, ['app/templates/about.gts'])).toBe('');
  });
});
