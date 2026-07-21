import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two entries share web/: the desktop director (index.html) and the
// standalone phone app (mobile.html, served at /m). Both build to web/dist,
// served by server/index.js. `npm run dev` proxies API + WS to :8000.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./web/index.html', import.meta.url)),
        mobile: fileURLToPath(new URL('./web/mobile.html', import.meta.url)),
      },
    },
  },
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
