import EmberRouter from '@embroider/router';
import config from './config/environment.ts';
import { bundle } from './route-splitting.ts';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('about');
  this.route('contact');
});

window._embroiderRouteBundles_ = [
  bundle('about', () => [import('./templates/about.gts')]),
  bundle('contact', () => [import('./templates/contact.gts')]),
];
