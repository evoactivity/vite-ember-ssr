import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox, cleanupSSRContent } from 'vite-ember-ssr/client';

// Install shoebox fetch interceptor before Ember boots.
// This replays server-captured API responses to avoid double-fetching.
installShoebox();

cleanupSSRContent();

Application.create(config.APP);
