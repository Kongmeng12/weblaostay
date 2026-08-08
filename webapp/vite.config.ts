import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 is the admin panel. Both can run at once during development, which
    // is the normal case: an admin approving a property while a guest books it.
    port: 5174,
    proxy: {
      // The API is a separate origin in dev; proxying keeps the browser on one
      // origin so tokens and CORS behave exactly as they will in production.
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      // Property photos are served by the API outside the /api prefix.
      '/uploads': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
});
