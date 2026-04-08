import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'vite-plugin': 'src/vite-plugin.ts',
    server: 'src/server.ts',
    client: 'src/client.ts',
    worker: 'src/worker.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: ['vite', 'happy-dom', 'tinypool'],
  },
});
