import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = (env.VITE_ORBIS_API_URL ?? env.VITE_HW_LIBRARY_API_URL ?? '').trim();
  if (mode === 'production' && !apiBaseUrl) {
    throw new Error('Production frontend builds require VITE_ORBIS_API_URL or VITE_HW_LIBRARY_API_URL.');
  }
  // In production the browser must reach the same origin's /api gateway. A bare
  // absolute origin would double the path (e.g. .../v1/library/assets instead of
  // /api/v1/library/assets), so the value is validated as a relative /api prefix.
  if (mode === 'production' && !apiBaseUrl.startsWith('/')) {
    throw new Error('Production VITE_ORBIS_API_URL must be a relative /api prefix, not an absolute origin.');
  }

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_ORBIS_API_URL': JSON.stringify(apiBaseUrl || ''),
      'import.meta.env.VITE_HW_LIBRARY_API_URL': JSON.stringify(env.VITE_HW_LIBRARY_API_URL ?? ''),
    },
    server: {
      port: 5174,
      proxy: { '/api': 'http://127.0.0.1:8789' },
    },
    preview: { port: 4174 },
  };
});
