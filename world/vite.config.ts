import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at electrosparkzz.in/world
export default defineConfig({
  base: '/world/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          physics: ['@react-three/rapier'],
        },
      },
    },
  },
});
