import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The hub is a separate process and a separate repository. In dev, Vite owns
// the page and proxies the API, so there is no CORS and no origin juggling.
// In production nginx does exactly the same thing (see hypha/dist/nginx-hypha.conf).
const hub = process.env.HYPHA_HUB ?? 'http://127.0.0.1:5522'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5523,
    proxy: {
      '/api': {
        target: hub,
        changeOrigin: true,
        // SSE (/api/exec/{id}/events) and the PTY websocket both need to stay open.
        ws: true,
      },
    },
  },
  build: {
    // Hashed assets live forever; nginx sets immutable caching on them and
    // no-store on index.html.
    outDir: 'dist',
    sourcemap: true,
  },
})
