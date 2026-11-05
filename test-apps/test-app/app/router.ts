import EmberRouter from '@embroider/router';
import config from './config/environment.ts';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('about');
  this.route('contact');
  this.route('waiter-test');
  this.route('missing');
  this.route('pokemon-fetch', function () {
    this.route('show', { path: '/:name' });
  });
  this.route('pokemon-warp-drive', function () {
    this.route('show', { path: '/:name' });
  });
});
