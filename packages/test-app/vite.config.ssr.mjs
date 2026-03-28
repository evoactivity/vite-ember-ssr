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
    ...emberSsr({
      appName: 'test-app',
    }),
  ],
  build: {
    ssr: 'app/app-ssr.ts',
    outDir: 'dist/server',
    target: 'node22',
    sourcemap: true,
    minify: false,
  },
  ssr: {
    noExternal: [
      /^@ember\//,
      /^@glimmer\//,
      /^@embroider\//,
      /^ember-/,
      'decorator-transforms',
    ],
  },
});
