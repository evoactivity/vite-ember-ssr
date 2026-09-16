import EmbroiderRouter from '@embroider/router';

import config from '#config';

import { lazyRouteBundles } from './custom-layout.ts';

export default class Router extends EmbroiderRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('about');
  this.route('contact');
});

/**
 * Route bundles (lazy-loaded route groups) have no nice API yet.
 *
 * Caveat:
 * - https://github.com/embroider-build/embroider/issues/2521
 */
(window as any)._embroiderRouteBundles_ = lazyRouteBundles(
  import.meta.glob('./routes/{about,contact}/+{route,template}.{ts,gts}'),
);
