import { defineConfig } from 'vite';

// `npx vite --config demo/vite.config.mjs` serves the screens on made-up data (no sign-in, no database).
export default defineConfig({ root: 'demo', server: { fs: { allow: ['..'] } } });
