import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = (env.VITE_ORBIS_API_URL ?? env.VITE_HW_LIBRARY_API_URL ?? '').trim();
  if (mode === 'production' && !apiBaseUrl) {
    throw new Error('Production frontend builds require VITE_ORBIS_API_URL or VITE_HW_LIBRARY_API_URL.');
  }

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: { '/api': 'http://127.0.0.1:8789' },
    },
    preview: { port: 4174 },
  };
});
