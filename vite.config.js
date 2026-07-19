import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Director app lives in web/, builds to web/dist (served by server/index.js).
// `npm run dev` proxies API + WS to a running `npm start` on :8000.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
      '/qr.svg': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
