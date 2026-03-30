import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox, shouldRehydrate } from 'vite-ember-ssr/client';

// Install shoebox fetch interceptor before Ember boots.
// This replays server-captured API responses to avoid double-fetching.
installShoebox();

// Boot with autoboot: false so we can control the render mode.
// On prerendered (SSG) routes, shouldRehydrate() returns true and
// Glimmer reuses the server-rendered DOM. On non-SSG routes, Ember
// boots normally without attempting rehydration.
const app = Application.create({ ...config.APP, autoboot: false });

app.visit(window.location.pathname + window.location.search, {
  ...(shouldRehydrate() ? { _renderMode: 'rehydrate' } : {}),
});
