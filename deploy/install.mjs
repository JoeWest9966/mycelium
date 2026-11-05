#!/usr/bin/env node
// One-click install: warehouse credential -> ssh -> hypha installer.
//
// The credential never reaches the browser and never touches the disk in a form
// that outlives the request:
//
//   warehouse /api/vps/<name>/secret   (loopback only, X-NW-Reveal: 1)
//        -> this process's memory
//        -> a 0600 temp file (key) or SSHPASS in the child env (password)
//        -> one ssh that runs the hub's install command
//        -> unlink, every path, including the failures
//
// Why here and not in hyphad: the hub is unauthenticated and runs arbitrary
// bash. Hand it a vps root credential and "can run bash on enrolled machines"
// silently becomes "can root every machine in the catalog". The panel already
// lives on a host that can reach both the warehouse and the targets, so the
// credential's blast radius is one process for the duration of one ssh.
//
// This module is not part of hypha's OpenAPI contract: the browser never calls
// it with a secret, and hyphad never sees it.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const REVEAL_HEADER = 'X-NW-Reveal'
const SSH_TIMEOUT_MS = Number(process.env.INSTALL_TIMEOUT_MS ?? 180_000)
// How long to wait for the new satellite to dial home before calling it a day.
const PRESENCE_POLL_MS = 20_000

/** Hosts with an install in flight, so two clicks cannot fight over one machine. */
const inFlight = new Map()

const emit = (res, event) => {
  if (res.writableEnded) return
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

const sseHead = (res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // nginx would otherwise hold the first bytes until the buffer fills.
    'x-accel-buffering': 'no',
  })
}

class InstallError extends Error {
  constructor(step, message, hint) {
    super(message)
    this.step = step
    this.hint = hint
  }
}

async function fetchSecret(warehouse, name) {
  const url = `${warehouse.replace(/\/$/, '')}/api/vps/${encodeURIComponent(name)}/secret`
  let res
  try {
    res = await fetch(url, { headers: { [REVEAL_HEADER]: '1', accept: 'application/json' } })
  } catch (err) {
    throw new InstallError(
      'secret',
      `warehouse unreachable at ${url}: ${err.message}`,
      'the warehouse API must be reachable from this host; set WAREHOUSE_LOCAL',
    )
  }
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not JSON: the shape below covers it */
  }
  if (!res.ok) {
    // The warehouse answers in its own envelope. Surfacing the raw body puts a
    // wall of pretty-printed JSON in the panel; the first error's message is the
    // sentence a human actually needs.
    const first = parsed?.errors?.[0]
    throw new InstallError(
      'secret',
      first?.message ?? `warehouse answered ${res.status} for ${name}: ${text.slice(0, 120)}`,
      first?.hint ??
        (res.status === 404
          ? 'the secret endpoint is loopback-only by design — call it from this host, not through a gateway'
          : res.status === 400 && text.includes('PANEL_REVEAL_REQUIRED')
            ? 'this warehouse build predates the reveal header; upgrade it'
            : null),
    )
  }
  const payload = parsed
  if (!payload) {
    throw new InstallError('secret', `${url} did not return JSON`, 'check WAREHOUSE_LOCAL points at nw-panel')
  }
  if (!payload.ok) {
    const first = payload.errors?.[0]
    throw new InstallError(
      'secret',
      `warehouse refused: ${first?.message ?? 'unknown error'}`,
      first?.hint ?? 'the machine may have no credential on file',
    )
  }
  return payload.data
}

/** The address to dial. Tailscale first: it is the one that works when the public IP does not. */
function pickAddress(entry) {
  const ips = entry.ips ?? []
  const ts = ips.find((i) => (i.label ?? '').toLowerCase().includes('tailscale'))
  return (ts ?? ips[0])?.addr
}

function sshTarget(entry) {
  const addr = pickAddress(entry)
  if (!addr) throw new InstallError('ssh', `${entry.name} has no address in the catalog`, null)
  return `${entry.user ?? 'root'}@${addr}`
}

async function mintInstallCommand(hub, headers, { label, tags }) {
  const res = await fetch(`${hub}/api/enroll-tokens`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ reusable: false, label, tags }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new InstallError('token', `hyphad could not mint a token (${res.status}): ${text.slice(0, 200)}`, null)
  }
  const payload = JSON.parse(text)
  if (!payload.install_cmd) {
    throw new InstallError('token', 'hyphad returned no install command', 'is it newer than the panel?')
  }
  return payload
}

/**
 * How a host is reachable, coarsely. The only question being answered: can a
 * machine at address A plausibly reach the hub at address B?
 */
function addressClass(host) {
  if (!host) return 'unknown'
  if (host.toLowerCase() === 'localhost') return 'loopback'
  if (host.toLowerCase().endsWith('.ts.net')) return 'tailnet'
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!m) return 'unknown'
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 100 && b >= 64 && b <= 127) return 'tailnet' // CGNAT: this is what Tailscale hands out
  if (a === 127) return 'loopback'
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'private'
  if (a === 169 && b === 254) return 'linklocal'
  return 'public'
}

const hubHostOf = (cmd) => {
  const m = /https?:\/\/([^/\s:]+)/.exec(cmd)
  return m ? m[1] : ''
}

/** Redact the one-shot token before anything is streamed to a browser or a log. */
function redactCommand(cmd) {
  return cmd.replace(/token=[A-Za-z0-9_-]+/g, 'token=<one-shot>')
}

async function runSsh({ secret, command, keepKnownHostsIn, onLine }) {
  const sshBin = 'ssh'
  const args = [
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${keepKnownHostsIn}`,
    '-o', 'ServerAliveInterval=5',
    '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'LogLevel=ERROR',
  ]
  const env = { ...process.env }
  const tempFiles = []

  const port = secret.port ?? 22
  if (port !== 22) args.push('-p', String(port))

  if (secret.kind === 'key') {
    if (!secret.key) throw new InstallError('ssh', 'warehouse returned a key entry with no key body', null)
    const file = path.join(os.tmpdir(), `hypha-push-${crypto.randomBytes(8).toString('hex')}.key`)
    fs.writeFileSync(file, secret.key, { mode: 0o600, flag: 'wx' })
    tempFiles.push(file)
    args.push('-i', file, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes')
  } else if (secret.kind === 'password') {
    if (!secret.password) throw new InstallError('ssh', 'warehouse returned a password entry with no password', null)
    // -e reads SSHPASS from the environment: the password stays out of `ps`,
    // unlike `sshpass -p <password>`.
    env.SSHPASS = secret.password
    args.push('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no')
  } else {
    throw new InstallError('ssh', `unknown credential kind ${JSON.stringify(secret.kind)}`, null)
  }

  const bin = secret.kind === 'password' ? 'sshpass' : sshBin
  const argv = secret.kind === 'password' ? ['-e', sshBin, ...args] : args
  argv.push(sshTarget(secret), command)

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(bin, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let killed = false
      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 3000).unref()
      }, SSH_TIMEOUT_MS)

      const pump = (stream, level) => {
        let buf = ''
        stream.on('data', (chunk) => {
          buf += chunk.toString()
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) if (line.trim()) onLine(level, line)
        })
        stream.on('end', () => {
          if (buf.trim()) onLine(level, buf)
        })
      }
      pump(child.stdout, 'out')
      pump(child.stderr, 'err')

      child.on('error', (err) => {
        clearTimeout(timer)
        reject(
          new InstallError(
            'ssh',
            `${bin} could not start: ${err.message}`,
            bin === 'sshpass' ? 'install sshpass on this host to use password credentials' : null,
          ),
        )
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (killed) {
          reject(new InstallError('ssh', `ssh exceeded ${SSH_TIMEOUT_MS / 1000}s and was killed`, null))
        } else if (code !== 0) {
          reject(
            new InstallError(
              'ssh',
              `ssh exited with ${code}`,
              code === 255
                ? 'ssh itself failed: key rejected, wrong port, or the host is not reachable'
                : 'the installer ran and failed — read its output above',
            ),
          )
        } else {
          resolve()
        }
      })
    })
  } finally {
    for (const f of tempFiles) {
      try {
        fs.rmSync(f, { force: true })
      } catch {
        /* best effort */
      }
    }
  }
}

async function revokeToken(hub, token) {
  if (!token) return
  try {
    await fetch(`${hub}/api/enroll-tokens/${encodeURIComponent(token)}`, { method: 'DELETE' })
  } catch {
    // Best effort: an unrevoked one-shot token still expires on its own.
  }
}

async function waitForPresence(hub, before, hint, onLine) {
  const deadline = Date.now() + PRESENCE_POLL_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const res = await fetch(`${hub}/api/hosts`)
      if (!res.ok) continue
      const hosts = await res.json()
      const fresh = hosts.find((h) => !before.has(h.id) && h.online)
      if (fresh) return fresh
    } catch {
      /* keep polling: the hub is local and this is best effort */
    }
  }
  onLine(
    'err',
    `installed, but no new host showed up within ${PRESENCE_POLL_MS / 1000}s — check systemctl status hypha-sat on ${hint}`,
  )
  return null
}

/**
 * POST /api/warehouse/install  {"name": "<catalog name>"}
 *
 * Streams Server-Sent Events: {step, line?, host?, hint?}. The response ends
 * with either {step:"done"} or {step:"error"}.
 */
export async function handleInstall(req, res, { hub, warehouse, trustForwarded }) {
  sseHead(res)

  let name
  try {
    const body = await readJson(req)
    name = String(body.name ?? '').trim()
  } catch (err) {
    emit(res, { step: 'error', message: `bad request body: ${err.message}` })
    res.end()
    return
  }
  if (!name) {
    emit(res, { step: 'error', message: 'name is required' })
    res.end()
    return
  }
  if (!warehouse) {
    emit(res, { step: 'error', message: 'no local warehouse API configured', hint: 'set WAREHOUSE_LOCAL' })
    res.end()
    return
  }
  if (inFlight.has(name)) {
    emit(res, { step: 'error', message: `${name} already has an install running` })
    res.end()
    return
  }
  inFlight.set(name, Date.now())

  // The installer prints ANSI colour. The panel renders text, not escape codes.
  const paint = (line) => line.replace(/\x1b\[[0-9;]*m/g, '')
  const onLine = (level, line) => emit(res, { step: 'log', stream: level, line: paint(line) })
  const hubHeaders = {
    accept: 'application/json',
    ...(trustForwarded && req.headers.host
      ? {
          'x-forwarded-host': req.headers.host,
          'x-forwarded-proto': req.socket.encrypted ? 'https' : 'http',
        }
      : {}),
  }
  const knownHosts = path.join(os.tmpdir(), `hypha-known-hosts-${crypto.randomBytes(6).toString('hex')}`)
  fs.writeFileSync(knownHosts, '', { mode: 0o600 })

  try {
    emit(res, { step: 'secret', message: `fetching credentials for ${name}` })
    const secret = await fetchSecret(warehouse, name)

    emit(res, { step: 'token', message: 'minting a one-shot enrollment token' })
    const minted = await mintInstallCommand(hub, hubHeaders, {
      label: `push to ${name}`,
      tags: ['warehouse', name],
    })

    // The installer runs on the target and fetches the hub itself. A hub that is
    // only on the tailnet cannot serve a public machine, and finding that out via
    // ssh costs a minute of hanging curl and a burned one-shot token.
    const hubHost = hubHostOf(minted.install_cmd)
    const hubClass = addressClass(hubHost)
    const targetClass = addressClass(pickAddress(secret))
    if ((hubClass === 'tailnet' || hubClass === 'loopback') && targetClass === 'public') {
      await revokeToken(hub, minted.token)
      throw new InstallError(
        'preflight',
        `${name} is at a public address but the hub is only reachable at ${hubHost}`,
        `join ${name} to the tailnet first, or point the hub's public_url at an address ${name} can reach`,
      )
    }

    const target = sshTarget(secret)
    emit(res, { step: 'ssh', message: `${target} <- ${redactCommand(minted.install_cmd)}` })

    const before = new Set()
    try {
      const hosts = await (await fetch(`${hub}/api/hosts`)).json()
      for (const h of hosts) before.add(h.id)
    } catch {
      /* if the hub hiccups, "new" just means "any online host" */
    }

    await runSsh({ secret, command: minted.install_cmd, keepKnownHostsIn: knownHosts, onLine })

    emit(res, { step: 'presence', message: 'waiting for the satellite to dial home' })
    const host = await waitForPresence(hub, before, target, onLine)
    emit(res, { step: 'done', host: host ?? null, name })
  } catch (err) {
    const step = err instanceof InstallError ? err.step : 'error'
    emit(res, { step: 'error', at: step, message: err.message, hint: err.hint ?? null })
  } finally {
    inFlight.delete(name)
    try {
      fs.rmSync(knownHosts, { force: true })
    } catch {
      /* best effort */
    }
    res.end()
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => {
      buf += c
      if (buf.length > 8192) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
