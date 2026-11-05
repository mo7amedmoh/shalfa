import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.ANALYZE === 'true'
      ? [visualizer({ filename: 'dist/stats.html', template: 'treemap', gzipSize: true, brotliSize: true, open: false })]
      : []),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', '@tanstack/react-query-persist-client'],
          maps: ['leaflet', 'react-leaflet', 'react-leaflet-cluster'],
          charts: ['recharts'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 2,
  },
});
