import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The hub is a separate process and a separate repository. In dev, Vite owns
// the page and proxies the API, so there is no CORS and no origin juggling.
// In production nginx does exactly the same thing (see hypha/dist/nginx-hypha.conf).
const hub = process.env.HYPHA_HUB ?? 'http://127.0.0.1:5522'

// The warehouse catalog is a second, external API (Nous -> nw-panel). The panel
// asks for one path; this is where dev points it. Production does the same thing
// with an nginx location, and hyphad can take the path over later without the
// front-end changing.
const warehouse =
  process.env.WAREHOUSE_API ?? 'http://100.106.43.81:4790/p/new1/vq0f03/api'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5523,
    proxy: {
      // Must come before /api: the more specific prefix wins.
      '/api/warehouse': {
        target: warehouse,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/warehouse/, ''),
      },
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
