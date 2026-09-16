import { defineConfig } from 'vite';
import { ember } from '@nullvoxpopuli/ember-vite';
import { emberSsg } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    emberSsg({
      routes: ['index', 'about', 'contact'],
    }),
  ],
});
