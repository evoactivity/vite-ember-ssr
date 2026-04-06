/**
 * SSR entry point for the monorepo test application.
 *
 * This app imports from a sibling workspace package (monorepo-lib)
 * that in turn imports @glimmer/tracking, exercising the pnpm
 * monorepo resolution path that is the subject of issue #4.
 */
import EmberApp from 'ember-strict-application-resolver';
import PageTitleService from 'ember-page-title/services/page-title';
import config from './config/environment.ts';
import Router from './router.ts';

class App extends EmberApp {
  modulePrefix = config.modulePrefix;
  modules = {
    './router': Router,
    './services/page-title': PageTitleService,
    ...import.meta.glob('./{routes,templates}/**/*.{ts,gts}', { eager: true }),
    ...import.meta.glob('./services/*.ts', { eager: true }),
  };
}

/**
 * Factory function for SSR. Creates a fresh Application instance
 * with autoboot disabled so the server can control the boot sequence
 * via app.visit(url, options).
 */
export function createSsrApp() {
  return App.create({
    ...config.APP,
    autoboot: false,
  });
}
