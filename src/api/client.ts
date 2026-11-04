// The only place that talks HTTP. Everything else imports from here, so the
// base64/UTF-8 rules and the error shape live in exactly one place.

import {
  KNOWN_API_VERSION,
  type EnrollTokenInfo,
  type EnrollTokenRequest,
  type EnrollTokenResponse,
  type ExecEvent,
  type ExecRecord,
  type ExecRequest,
  type ExecResponse,
  type AuditEntry,
  type FilePushRequest,
  type FilePushResponse,
  type Host,
  type Meta,
  type PtySession,
} from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const text = await res.text()
  if (!res.ok) {
    // The hub's error body is {error}. Anything else (a proxy's HTML 502, for
    // instance) is still worth surfacing verbatim rather than swallowing.
    let msg = text || res.statusText
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) msg = parsed.error
    } catch {
      /* not JSON: keep the raw text */
    }
    throw new ApiError(msg, res.status)
  }

  return (text ? JSON.parse(text) : null) as T
}

/**
 * Handshake. Returns the hub's metadata, or throws when the hub speaks a
 * contract this build does not know.
 *
 * The failure mode this prevents: hub adds a required field, panel renders
 * `undefined` everywhere, and the bug report says "it's broken".
 */
export async function getMeta(): Promise<Meta> {
  const meta = await call<Meta>('/api/meta')
  if (typeof meta.api_version !== 'number') {
    throw new Error('hub did not report api_version — refusing to run')
  }
  if (meta.api_version > KNOWN_API_VERSION) {
    throw new Error(
      `hub speaks API v${meta.api_version}, this panel was built for v${KNOWN_API_VERSION}. ` +
        `Upgrade the panel.`,
    )
  }
  return meta
}

export const listHosts = () => call<Host[]>('/api/hosts')

export const setHostTags = (id: string, tags: string[]) =>
  call<{ ok: boolean }>(`/api/hosts/${encodeURIComponent(id)}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  })

export const deleteHost = (id: string) =>
  call<{ ok: boolean }>(`/api/hosts/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const listEnrollTokens = () => call<EnrollTokenInfo[]>('/api/enroll-tokens')

export const createEnrollToken = (body: EnrollTokenRequest) =>
  call<EnrollTokenResponse>('/api/enroll-tokens', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const revokeEnrollToken = (token: string) =>
  call<{ ok: boolean }>(`/api/enroll-tokens/${encodeURIComponent(token)}`, {
    method: 'DELETE',
  })

export const recentExecs = () => call<ExecRecord[]>('/api/execs')

/** Kill a run. Hosts that already exited are simply not in the response. */
export const cancelExec = (id: string) =>
  call<{ cancelled: string[] }>(`/api/exec/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

export interface AuditQuery {
  limit?: number
  action?: string
  host?: string
}

export const listAudit = (q: AuditQuery = {}) => {
  const params = new URLSearchParams()
  if (q.limit) params.set('limit', String(q.limit))
  if (q.action) params.set('action', q.action)
  if (q.host) params.set('host', q.host)
  const qs = params.toString()
  return call<AuditEntry[]>(`/api/audit${qs ? `?${qs}` : ''}`)
}

/**
 * Push a file to hosts. `content` is base64; the browser has no other way to
 * put bytes in JSON, and the agent writes it atomically.
 */
export const pushFile = (body: FilePushRequest) =>
  call<FilePushResponse>('/api/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Allocate a shell session. Attach with `ptyUrl({ ptyId })`. */
export const openPty = (body: { host_id: string; cols?: number; rows?: number }) =>
  call<PtySession>('/api/pty', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export const createExec = (body: ExecRequest) =>
  call<ExecResponse>('/api/exec', { method: 'POST', body: JSON.stringify(body) })

/**
 * Subscribe to one exec's output.
 *
 * SSE, one `e` event per line of JSON. Returns an unsubscribe function; call it
 * on unmount or the connection outlives the component that asked for it.
 */
export function streamExec(
  execId: string,
  onEvent: (event: ExecEvent) => void,
  onError: (err: Error) => void,
): () => void {
  const url = `/api/exec/${encodeURIComponent(execId)}/events`
  const es = new EventSource(url)

  es.addEventListener('e', (msg) => {
    let event: ExecEvent
    try {
      event = JSON.parse((msg as MessageEvent<string>).data) as ExecEvent
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
      return
    }
    onEvent(event)
    // The hub streams from cursor 0 on every connection and has no replay
    // cursor. Letting EventSource reconnect after `done` therefore re-delivers
    // the whole run a second time — which is exactly what it did.
    if (event.kind === 'done') es.close()
  })

  // Same reasoning for any other close: a reconnect here would duplicate
  // output rather than resume it.
  es.addEventListener('error', () => es.close())

  return () => es.close()
}

/** base64 → bytes. `ExecOutput.data` and `TermOut.output.data` are binary. */
export function b64Bytes(data: string): Uint8Array {
  const bin = atob(data)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** base64 → text, decoded as UTF-8 so multi-byte characters survive chunking. */
export function b64Text(data: string): string {
  return new TextDecoder().decode(b64Bytes(data))
}

/**
 * WebSocket URL for a shell.
 *
 * `TermIn.input.data` is plain UTF-8; `TermOut.output.data` is base64. Mixing
 * those up produces a terminal that looks dead.
 *
 * Attach by `ptyId` when a session already exists (reconnect): the hub replays
 * the scrollback and you land back in the same shell. Attach by `hostId` to get
 * a throwaway session that dies with the socket.
 */
export function ptyUrl(target: { ptyId: string } | { hostId: string; cols: number; rows: number }): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const q =
    'ptyId' in target
      ? new URLSearchParams({ pty_id: target.ptyId })
      : new URLSearchParams({
          host_id: target.hostId,
          cols: String(target.cols),
          rows: String(target.rows),
        })
  return `${proto}//${location.host}/api/pty?${q}`
}
