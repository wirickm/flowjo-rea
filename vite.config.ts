import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces dist/index.html with all JS, CSS and the analysis
// worker inlined, so it can be opened directly from disk.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // Classic (IIFE) worker: module workers from blob: URLs do not start under file://.
  worker: { format: 'iife' },
  // The single-file build has no modulepreload links; the polyfill would only
  // add an unused fetch() to the bundle (weakens the local-only claim).
  build: { modulePreload: { polyfill: false } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
