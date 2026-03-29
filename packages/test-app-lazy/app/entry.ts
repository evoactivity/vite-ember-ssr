import Application from './app.ts';
import config from './config/environment.ts';

// Cleanup mode: Ember boots normally with autoboot, and the SSR boundary
// markers are removed once the app renders.
Application.create(config.APP);
