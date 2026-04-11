import EmberApp from 'ember-strict-application-resolver';
import '@warp-drive/ember/install';
import { setBuildURLConfig } from '@warp-drive/utilities/json-api';
import PageTitleService from 'ember-page-title/services/page-title';
import config from './config/environment.ts';
import Router from './router.ts';

setBuildURLConfig({
  host: 'https://pokeapi.co',
  namespace: 'api/v2',
});

export default class App extends EmberApp {
  LOG_TRANSITIONS = true;

  // Extremely detailed logging, highlighting every internal
  // step made while transitioning into a route, including
  // `beforeModel`, `model`, and `afterModel` hooks, and
  // information about redirects and aborted transitions
  LOG_TRANSITIONS_INTERNAL = true;

  modulePrefix = config.modulePrefix;
  modules = {
    './router': Router,
    './services/page-title': PageTitleService,
    ...import.meta.glob('./{routes,templates}/**/*.{ts,gts}', { eager: true }),
    ...import.meta.glob('./services/*.ts', { eager: true }),
    ...import.meta.glob('./controllers/*.ts', { eager: true }),
  };
}
