import Application from './app.ts';
import config from './config/environment.ts';
import { installShoebox, bootRehydrated } from 'vite-ember-ssr/client';

installShoebox();
bootRehydrated(Application, config);
