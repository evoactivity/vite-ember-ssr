import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox } from 'vite-ember-ssr/client';

// Install shoebox fetch interceptor before Ember boots.
// This replays server-captured API responses to avoid double-fetching.
installShoebox();

// Rehydrate mode: boot with autoboot: false and visit() with _renderMode: 'rehydrate'.
// Glimmer reuses the server-rendered DOM instead of replacing it.
const app = Application.create({ ...config.APP, autoboot: false });

app.visit(window.location.pathname + window.location.search, {
  _renderMode: 'rehydrate',
});
