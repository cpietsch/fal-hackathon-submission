import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// the node server (server/index.js, port 8000) keeps owning APIs, WebSocket,
// sessions and the phone/gallery pages — vite only serves the desktop app
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
      '/qr.svg': 'http://localhost:8000',
      '/vendor': 'http://localhost:8000',
      '/phone.html': 'http://localhost:8000',
      '/gallery.html': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: { outDir: 'dist' },
})
