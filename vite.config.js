import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'cannon-es': ['cannon-es']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['three', 'cannon-es']
  },
  server: {
    host: true,
    port: 3000
  }
});
