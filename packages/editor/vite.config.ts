import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin as the editor server, so there is no CORS question and the
    // WebSocket needs no absolute URL.
    proxy: {
      '/api': { target: 'http://127.0.0.1:5174', ws: true },
      '/cache': { target: 'http://127.0.0.1:5174' },
    },
  },
});
