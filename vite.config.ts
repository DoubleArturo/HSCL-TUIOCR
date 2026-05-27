import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: isDev
      ? {
          // Dev only: expose keys via process.env so geminiService direct-API path works
          'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? ''),
          'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? ''),
          // Force direct API on in dev
          'import.meta.env.VITE_USE_DIRECT_API': JSON.stringify('true'),
        }
      : {
          // Production: never inject keys; proxy handles them server-side
          'process.env.GEMINI_API_KEY': JSON.stringify(''),
          'process.env.API_KEY': JSON.stringify(''),
          'import.meta.env.VITE_USE_DIRECT_API': JSON.stringify('false'),
        },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
