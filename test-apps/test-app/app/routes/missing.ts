import Route from '@ember/routing/route';
import { setStatusCode } from 'vite-ember-ssr/client';

/**
 * A page that exists, but answers 404, like an app's not-found page.
 */
export default class MissingRoute extends Route {
  model() {
    setStatusCode(404);
  }
}
