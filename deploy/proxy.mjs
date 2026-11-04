#!/usr/bin/env node
// Reference deployment without a web server.
//
// mycelium is a static bundle plus one API. If you already run nginx, use
// hypha's dist/nginx-hypha.conf instead — it does the same thing with better
// caching and TLS. This exists for the case where you don't: a single
// dependency-free process that serves the build and proxies the two upstreams.
//
//   PORT=5524 DIST=/var/www/mycelium node deploy/proxy.mjs
//
// Route map (identical to the nginx config, on purpose):
//   /api/warehouse/*  -> warehouse API   (external contract, optional)
//   /api/*            -> hyphad          (streaming: SSE + websocket)
//   /agent            -> hyphad          (satellites, in case you front it)
//   /install.sh, /dl/ -> hyphad          (installer channel; not panel routes)
//   everything else   -> dist/, SPA fallback to index.html

import http from 'node:http'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 5524)
const DIST = process.env.DIST ?? './dist'
const HUB = {
  host: process.env.HUB_HOST ?? '127.0.0.1',
  port: Number(process.env.HUB_PORT ?? 5522),
}
// Optional. Without it, /api/warehouse/* answers 501 with an explanation
// instead of a confusing 404 from hyphad.
const WAREHOUSE = process.env.WAREHOUSE_URL ?? ''

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const upstreamFor = (pathname) => {
  // The installer channel belongs to the hub, not to the static bundle. Miss
  // this and /dl/hypha-sat-linux-x86_64 (no extension) gets the SPA fallback,
  // so an install pipes HTML into sudo sh.
  if (pathname === '/agent' || pathname === '/install.sh' || pathname === '/health') {
    return { host: HUB.host, port: HUB.port, scheme: 'http' }
  }
  if (pathname.startsWith('/dl/')) return { host: HUB.host, port: HUB.port, scheme: 'http' }
  if (pathname.startsWith('/api/warehouse/')) {
    if (!WAREHOUSE) return null
    const u = new URL(WAREHOUSE)
    return {
      host: u.hostname,
      port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
      scheme: u.protocol.replace(':', ''),
      // The upstream base may carry a prefix (/p/<project>/<id>/api), so the
      // location's own prefix is stripped and the base prefix prepended.
      prefix: u.pathname.replace(/\/$/, ''),
      strip: '/api/warehouse',
    }
  }
  if (pathname.startsWith('/api/')) return { host: HUB.host, port: HUB.port, scheme: 'http' }
  return null
}

function proxy(req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  const target = upstreamFor(url.pathname)
  if (!target) {
    if (url.pathname.startsWith('/api/warehouse/')) {
      res.writeHead(501, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(
        'no warehouse configured\n\nset WAREHOUSE_URL, e.g.\n' +
          '  WAREHOUSE_URL=https://j1900.tail8d0018.ts.net:8443 node deploy/proxy.mjs\n',
      )
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }

  const up = http.request(
    {
      host: target.host,
      port: target.port,
      path: (target.prefix ?? '') + (target.strip ? url.pathname.replace(target.strip, '') : url.pathname) + url.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${target.host}:${target.port}`,
        // Keep the address the browser used. hyphad builds install commands from
        // it, and without this every command would be minted for 127.0.0.1:5599 —
        // an address that exists only on this box.
        'x-forwarded-host': req.headers.host ?? `${target.host}:${target.port}`,
        'x-forwarded-proto': req.socket.encrypted ? 'https' : 'http',
      },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      // No buffering: this path carries SSE and terminal streams.
      upRes.pipe(res)
    },
  )
  up.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`upstream ${target.host}:${target.port} failed: ${err.message}\n`)
    } else {
      res.end()
    }
  })
  req.pipe(up)
}

function staticFile(req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  const rel = decodeURIComponent(url.pathname)
  const resolved = path.join(DIST, rel)
  if (!resolved.startsWith(path.resolve(DIST))) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }

  let file = resolved
  if (!file.endsWith('/') && !fs.existsSync(file)) {
    // SPA fallback, except for things that look like assets: a missing hash is
    // a real 404, not a route.
    file = path.extname(rel) ? file : path.join(DIST, 'index.html')
  } else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html')
  }

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }

  const ext = path.extname(file)
  const headers = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // index.html must never be cached: a deploy would otherwise strand
    // browsers on a shell that references assets which no longer exist.
    'cache-control': path.basename(file) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  }
  res.writeHead(200, headers)
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (upstreamFor(url.pathname)) proxy(req, res)
  else staticFile(req, res)
})

// WebSockets (/api/pty) need a raw tunnel; there is no frame parsing to do.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const target = upstreamFor(url.pathname)
  if (!target) {
    socket.destroy()
    return
  }
  const up = net.connect(target.port, target.host, () => {
    const headers = Object.entries({
      ...req.headers,
      host: `${target.host}:${target.port}`,
      'x-forwarded-host': req.headers.host ?? `${target.host}:${target.port}`,
    })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n')
    const wsPath = (target.prefix ?? '') + (target.strip ? url.pathname.replace(target.strip, '') : url.pathname) + url.search
    up.write(`${req.method} ${wsPath} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head?.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})

server.listen(PORT, () => {
  console.log(`mycelium proxy on http://0.0.0.0:${PORT}`)
  console.log(`  dist      ${path.resolve(DIST)}`)
  console.log(`  api       ${HUB.host}:${HUB.port}`)
  console.log(`  warehouse ${WAREHOUSE || '(none — /api/warehouse/* will 501)'}`)
})
