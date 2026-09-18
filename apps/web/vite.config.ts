import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // compile the shared engine from source in both dev and build
    alias: { '@siam/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173 },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'], globals: false },
});
