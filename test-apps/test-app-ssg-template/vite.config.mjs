import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsg } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  build: {
    rollupOptions: {
      // ssr.html is the template of the prerendered pages, see `template` below.
      input: { main: 'index.html', ssr: 'ssr.html' },
    },
  },
  plugins: [
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
    emberSsg({
      routes: ['index', 'about'],
      template: 'ssr.html',
    }),
  ],
});
