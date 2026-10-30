import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
