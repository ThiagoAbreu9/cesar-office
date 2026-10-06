import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * - `vite` / `vite build`: modo servidor — conecta no realtime real (DEMO_MODE) em VITE_REALTIME_HTTP.
 * - `vite build --mode sandbox`: tudo no navegador, com colegas simulados, num ÚNICO arquivo HTML.
 */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'sandbox' ? [viteSingleFile()] : [])],
  define: { __SANDBOX__: JSON.stringify(mode === 'sandbox') },
  build: {
    outDir: mode === 'sandbox' ? 'dist-sandbox' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173 },
}));
