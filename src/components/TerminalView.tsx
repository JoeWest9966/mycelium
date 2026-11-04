import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { b64Bytes, ptyUrl } from '../api/client'
import type { Host } from '../api/types'

type Props = {
  host: Host
  onClose: () => void
}

/**
 * A shell on one host, over `/api/pty`.
 *
 * Frame asymmetry, straight from the contract: what we send (`TermIn.input`) is
 * plain UTF-8 keystrokes, what we receive (`TermOut.output`) is base64 of raw
 * terminal bytes. Writing a decoded *string* into xterm corrupts anything that
 * is not valid UTF-8, so output goes in as a byte array.
 */
export default function TerminalView({ host, onClose }: Props) {
  const hostEl = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = hostEl.current
    if (!el) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10_000,
      theme: {
        background: '#05070a',
        foreground: '#d6dde5',
        cursor: '#3ce6b0',
        selectionBackground: '#2c3540',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)

    const doFit = () => {
      try {
        fit.fit()
      } catch {
        /* the element can be 0×0 for one frame while the overlay mounts */
      }
    }
    doFit()

    const ws = new WebSocket(ptyUrl(host.id, term.cols, term.rows))

    const inputSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'input', data }))
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'resize', cols, rows }))
    })

    ws.onopen = () => {
      setStatus('connected')
      doFit()
      term.focus()
    }

    ws.onmessage = (ev) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      const frame = msg as { t?: string; data?: string; code?: number | null; message?: string }
      switch (frame.t) {
        case 'output':
          if (frame.data) term.write(b64Bytes(frame.data))
          break
        case 'exit':
          term.write('\r\n\x1b[38;5;244m[session closed]\x1b[0m\r\n')
          setStatus('closed')
          break
        case 'error':
          setError(frame.message ?? 'unknown error')
          setStatus('error')
          break
      }
    }

    ws.onclose = () => {
      setStatus((s) => (s === 'error' ? s : 'closed'))
    }

    const onResize = () => doFit()
    window.addEventListener('resize', onResize)

    // Resize once the overlay has actually laid out, or the first fit is against
    // a zero-height box and the shell starts at 80×24.
    const raf = requestAnimationFrame(() => {
      doFit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }))
      }
    })

    // Escape closes, like every terminal worth using.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      inputSub.dispose()
      resizeSub.dispose()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'close' }))
        ws.close()
      }
      term.dispose()
    }
  }, [host.id, onClose])

  return (
    <div className="term-overlay" role="dialog" aria-modal="true" aria-label={`${host.hostname} shell`}>
      <div className="term-bar">
        <span className="term-title">{host.hostname}</span>
        <span className={`term-status ${status}`}>{status}</span>
        {error && <span className="term-error">{error}</span>}
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="term-host" ref={hostEl} />
    </div>
  )
}
