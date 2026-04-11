import { defineConfig } from 'vite';
import { extensions, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { emberSsr } from 'vite-ember-ssr/vite-plugin';

export default defineConfig({
  plugins: [
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
    emberSsr({
      shoebox: true,
      rehydrate: true,
    }),
  ],
});
