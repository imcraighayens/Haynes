import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Letter logos must be data URLs: printed letters render in a blank iframe
    assetsInlineLimit: (file) => (file.includes('/src/assets/') ? true : undefined),
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          vendor: ['lucide-react', 'clsx', 'qrcode-generator'],
        },
      },
    },
  },
})
