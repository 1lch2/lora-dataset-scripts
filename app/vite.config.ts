import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    cors: false,
    strictPort: true,
    proxy: Object.fromEntries(
      ['/api', '/image'].map((path) => [
        path,
        {
          target: process.env.REVIEW_API_URL || 'http://127.0.0.1:8765',
          changeOrigin: true,
        },
      ]),
    ),
  },
});
