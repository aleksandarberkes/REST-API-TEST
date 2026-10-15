import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run ui:dev` → hot-reloading UI on :5173, talking to the runner server on :4000 (`npm run lt -- ui`).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:4000', '/runs': 'http://localhost:4000' },
  },
});
