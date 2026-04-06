import Application from './app.ts';
import config from './config/environment.ts';

const app = Application.create({ ...config.APP, autoboot: false });

app.visit(window.location.pathname + window.location.search);
