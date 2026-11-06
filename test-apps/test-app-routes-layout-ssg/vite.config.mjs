import { defineConfig } from 'vite';
import { emberSsg } from 'vite-ember-ssr/vite-plugin';
import './regexp-escape-polyfill.mjs';

// Loaded after the polyfill above. A static import would run first,
// because Vite bundles this config and hoists package imports.
const { ember } = await import('@nullvoxpopuli/ember-vite');

export default defineConfig({
  plugins: [
    ember(),
    emberSsg({
      routes: ['index', 'about', 'contact'],
    }),
  ],
});
