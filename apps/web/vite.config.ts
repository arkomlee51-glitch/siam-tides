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
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: false,
    // ค่าปลอมพอให้ createClient() ตอน import ไม่ throw — เทสต์ที่แตะ Supabase จริง ๆ (auth/network) ต้อง mock '../src/api/supabase' เอง
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
