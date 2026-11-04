// Interactive shell over /api/pty.
//
// Two-step on purpose: POST allocates a session on the hub, then the WebSocket
// attaches to it. That split is what makes the shell survive a dropped socket —
// a reload, a laptop lid, a wifi handoff — instead of killing the process you
// were in the middle of. The session id is kept in sessionStorage so a reload
// reattaches to the same shell.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ApiError, b64Bytes, openPty, ptyUrl } from '../api/client'
import type { Host, TermIn, TermOut } from '../api/types'

type Status = 'connecting' | 'connected' | 'detached' | 'exited' | 'error'

interface Props {
  host: Host
  onClose: () => void
}

const storageKey = (hostId: string) => `hypha.pty.${hostId}`

export function TerminalView({ host, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const closingRef = useRef(false)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState<string>('')

  const send = useCallback((msg: TermIn) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  /** Attach to a known session id. Returns false if the hub no longer has it. */
  const attach = useCallback(
    (ptyId: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(ptyUrl({ ptyId }))
        wsRef.current = ws
        let settled = false
        const settle = (ok: boolean) => {
          if (!settled) {
            settled = true
            resolve(ok)
          }
        }

        ws.onopen = () => {
          setStatus('connected')
          setMessage('')
          settle(true)
        }
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data) as TermOut
          if (msg.t === 'output') {
            // Raw terminal bytes, never a decoded string: a chunk can split a
            // multi-byte character and TextDecoder would eat it.
            termRef.current?.write(b64Bytes(msg.data))
          } else if (msg.t === 'exit') {
            setStatus('exited')
            setMessage(msg.code == null ? 'shell exited' : `shell exited (${msg.code})`)
            ptyIdRef.current = null
            sessionStorage.removeItem(storageKey(host.id))
            settle(false)
          } else if (msg.t === 'error') {
            // "unknown session" means the hub reaped it — start a fresh one.
            settle(false)
            setStatus('error')
            setMessage(msg.message)
          }
        }
        ws.onerror = () => settle(false)
        ws.onclose = () => {
          settle(false)
          if (closingRef.current || ptyIdRef.current === null) return
          setStatus('detached')
          setMessage('connection lost — the shell is still running')
        }
      }),
    [host.id],
  )

  const start = useCallback(async () => {
    const term = termRef.current
    if (!term) return
    setStatus('connecting')
    setMessage('')
    try {
      const session = await openPty({
        host_id: host.id,
        cols: term.cols,
        rows: term.rows,
      })
      ptyIdRef.current = session.pty_id
      sessionStorage.setItem(storageKey(host.id), session.pty_id)
      await attach(session.pty_id)
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof ApiError ? e.message : String(e))
    }
  }, [attach, host.id])

  /** Reconnect: reattach if the session is alive, otherwise start over. */
  const reconnect = useCallback(async () => {
    const saved = ptyIdRef.current ?? sessionStorage.getItem(storageKey(host.id))
    if (saved) {
      setStatus('connecting')
      const ok = await attach(saved)
      if (ok) return
      ptyIdRef.current = null
      sessionStorage.removeItem(storageKey(host.id))
    }
    await start()
  }, [attach, start])

  const closeSelf = useCallback(() => {
    closingRef.current = true
    sessionStorage.removeItem(storageKey(host.id))
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'close' }))
    onClose()
  }, [host.id, onClose])

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      theme: { background: '#0b0d10', foreground: '#d6dbe1', cursor: '#7dd3a0' },
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit
    if (boxRef.current) term.open(boxRef.current)

    // The overlay was just mounted, so the first fit can measure a zero-height
    // box and pick 80x24. Fit again once layout settles.
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        /* container not laid out yet */
      }
    })

    term.onData((data) => send({ t: 'input', data }))
    term.onResize(({ cols, rows }) => send({ t: 'resize', cols, rows }))
    term.onKey(({ domEvent }) => {
      if (domEvent.key === 'Escape' && domEvent.ctrlKey) void closeSelf()
    })

    void reconnect()

    const onWinResize = () => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('resize', onWinResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onWinResize)
      closingRef.current = true
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'close' }))
      ws?.close()
      term.dispose()
      // Deliberately keeps sessionStorage: the shell outlives this component,
      // and reopening the host should offer to reattach rather than start new.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const label: Record<Status, string> = {
    connecting: 'connecting',
    connected: 'connected',
    detached: 'detached',
    exited: 'exited',
    error: 'error',
  }

  return (
    <div className="term-overlay">
      <div className="term-bar">
        <span className="term-host-name">{host.hostname}</span>
        <span className={`term-status term-status-${status}`}>{label[status]}</span>
        {message && <span className="term-msg">{message}</span>}
        <span className="term-spacer" />
        {(status === 'detached' || status === 'error') && (
          <button className="btn btn-small" onClick={() => void reconnect()}>
            Reconnect
          </button>
        )}
        {status === 'exited' && (
          <button className="btn btn-small" onClick={() => void start()}>
            New shell
          </button>
        )}
        <button className="btn btn-small btn-ghost" onClick={closeSelf}>
          Close
        </button>
      </div>
      <div className="term-host-box" ref={boxRef} />
    </div>
  )
}
