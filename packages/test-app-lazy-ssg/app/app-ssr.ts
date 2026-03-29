/**
 * SSR entry point for the Ember application.
 *
 * Uses the same strict resolver as the client app but with autoboot
 * disabled so the server can control boot timing via app.visit().
 *
 * Note: This file intentionally mirrors app.ts as closely as possible.
 * The same router import triggers lazy bundle registration, and the same
 * negative glob exclusions keep lazy routes out of the eager bundle.
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
    ...import.meta.glob(
      [
        './{routes,templates}/**/*.{ts,gts}',
        '!./templates/about.gts',
        '!./templates/contact.gts',
      ],
      { eager: true }
    ),
    ...import.meta.glob('./services/*.ts', { eager: true }),
    ...import.meta.glob('./controllers/*.ts', { eager: true }),
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
