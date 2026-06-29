import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy so the SPA talks to the API on :4000 (REST + WS) from a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/calls/live': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
