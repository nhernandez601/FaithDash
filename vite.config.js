import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
const single = process.env.SINGLE === '1';
export default defineConfig({
  base: './',
  plugins: single ? [viteSingleFile()] : [],
  build: {
    target: 'es2020', chunkSizeWarningLimit: 2000, outDir: single ? 'dist-single' : 'dist',
    // the normal site also ships the 3D test page (3d.html); the single-file build stays the 2D game only
    rollupOptions: single ? {} : { input: { main: 'index.html', three: '3d.html' } },
  },
  server: { host: true, port: 5173 },
});
