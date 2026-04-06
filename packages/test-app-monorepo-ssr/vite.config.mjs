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
    emberSsr(),
  ],
  ssr: {
    // Force monorepo-lib to be left external during the SSR build.
    // This simulates what happens with real node_modules packages (like
    // tracked-built-ins) that Vite externalizes by default. When the
    // external package imports @glimmer/tracking at runtime, pnpm's
    // strict node_modules layout can't resolve it — reproducing the
    // failure described in https://github.com/evoactivity/vite-ember-ssr/issues/4
    external: ['monorepo-lib'],
  },
});
