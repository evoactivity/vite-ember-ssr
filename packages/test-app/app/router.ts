import EmberRouter from '@embroider/router';
import config from './config/environment.ts';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('about');
  this.route('contact');
  this.route('pokemon-fetch', function () {
    this.route('show', { path: '/:name' });
  });
});
