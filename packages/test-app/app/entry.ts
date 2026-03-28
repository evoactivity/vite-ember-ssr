import Application from './app.ts';
import config from './config/environment.ts';
import { cleanupSSRContent } from 'vite-ember-ssr/client';

cleanupSSRContent();

Application.create(config.APP);
