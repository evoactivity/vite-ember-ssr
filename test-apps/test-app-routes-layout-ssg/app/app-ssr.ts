/**
 * SSR entry point.
 *
 * Mirrors app.ts, with autoboot disabled
 * so the server controls boot timing via app.visit().
 */
import Application from '@ember/application';

import config from '#config';

import { customLayout } from './custom-layout.ts';

class App extends Application {
  modules = {
    ...import.meta.glob('./router.*', { eager: true }),
    ...customLayout(
      import.meta.glob(
        './routes/{application,index}/+{route,template}.{ts,gts}',
        {
          eager: true,
        },
      ),
    ),
  };
}

export function createSsrApp() {
  return App.create({
    ...config.APP,
    autoboot: false,
  });
}
