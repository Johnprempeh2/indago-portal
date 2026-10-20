import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: { rollupOptions: { input: {
    portal: resolve('index.html'),
    demo: resolve('demo/index.html'),
  } } },
});
