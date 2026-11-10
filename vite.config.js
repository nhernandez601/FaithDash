import { defineConfig } from 'vite';
// the site is the 3D game (index.html); relative paths so it works under any folder (GitHub Pages: /FaithDash/)
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 2000, outDir: 'dist' },
  server: { host: true, port: 5173 },
});
