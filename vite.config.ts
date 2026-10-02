import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // three.js is large but only loads when the 3D view opens.
  build: { chunkSizeWarningLimit: 1600 },
  server: { port: 5173, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
    environment: 'node',
  },
});
